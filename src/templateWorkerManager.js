const TEMPLATE_PIXEL_WORKER_SOURCE = typeof __TEMPLATE_PIXEL_WORKER_SOURCE__ !== 'undefined'
  ? __TEMPLATE_PIXEL_WORKER_SOURCE__
  : '';

const DEFAULT_TEMPLATE_WORKER_POOL_SIZE = Math.min(
  4,
  Math.max(1, (typeof navigator !== 'undefined' && Number(navigator.hardwareConcurrency)) ? navigator.hardwareConcurrency - 1 : 1)
);

const supportsTransferableArrayBuffer = () => {
  try {
    const channel = new MessageChannel();
    const buffer = new ArrayBuffer(1);
    channel.port1.postMessage(buffer, [buffer]);
    return buffer.byteLength === 0;
  } catch (_) {
    return false;
  }
};

export const isTemplateWorkerRuntimeSupported = () => (
  typeof Worker !== 'undefined'
  && typeof Blob !== 'undefined'
  && typeof URL !== 'undefined'
  && typeof URL.createObjectURL === 'function'
  && typeof OffscreenCanvas !== 'undefined'
  && supportsTransferableArrayBuffer()
  && typeof TEMPLATE_PIXEL_WORKER_SOURCE === 'string'
  && TEMPLATE_PIXEL_WORKER_SOURCE.trim().length > 0
);

class TemplateWorkerManager {
  constructor() {
    this.supported = null;
    this.failed = false;
    this.url = null;
    this.workers = [];
    this.queue = [];
    this.jobs = new Map();
    this.nextJobId = 1;
    this.cancelledGenerations = new Set();
  }

  canUseWorkers() {
    if (this.failed) return false;
    if (this.supported === null) {
      this.supported = isTemplateWorkerRuntimeSupported();
    }
    return this.supported;
  }

  cancelGeneration(generation) {
    if (!generation) return;
    this.cancelledGenerations.add(generation);
    this.queue = this.queue.filter((job) => {
      if (job.generation !== generation) return true;
      this.jobs.delete(job.id);
      job.reject?.(new Error('Template worker job cancelled.'));
      return false;
    });
  }

  async runTask(type, payload, { transferList = [], generation = null } = {}) {
    if (!this.canUseWorkers()) {
      return null;
    }
    try {
      this.ensurePool();
    } catch (_) {
      this.failed = true;
      return null;
    }
    if (generation && this.cancelledGenerations.has(generation)) {
      return null;
    }
    return new Promise((resolve, reject) => {
      const id = this.nextJobId++;
      const job = { id, type, payload, transferList, generation, resolve, reject };
      this.jobs.set(id, job);
      this.queue.push(job);
      this.pumpQueue();
    });
  }

  ensurePool() {
    if (this.workers.length) return;
    this.url = URL.createObjectURL(new Blob([TEMPLATE_PIXEL_WORKER_SOURCE], { type: 'text/javascript' }));
    for (let index = 0; index < DEFAULT_TEMPLATE_WORKER_POOL_SIZE; index++) {
      const worker = new Worker(this.url);
      const slot = { worker, busy: false, jobId: null };
      worker.onmessage = (event) => {
        const { id, ok, result, error } = event.data || {};
        const job = this.jobs.get(id);
        this.jobs.delete(id);
        slot.busy = false;
        slot.jobId = null;
        if (job) {
          if (job.generation && this.cancelledGenerations.has(job.generation)) {
            job.resolve(null);
          } else if (ok) {
            job.resolve(result);
          } else {
            job.reject(new Error(error || 'Template worker failed.'));
          }
        }
        this.pumpQueue();
      };
      worker.onerror = (event) => {
        const job = slot.jobId ? this.jobs.get(slot.jobId) : null;
        if (job) {
          this.jobs.delete(slot.jobId);
          job.reject(new Error(event?.message || 'Template worker crashed.'));
        }
        slot.busy = false;
        slot.jobId = null;
        this.failed = true;
        this.destroyPool();
      };
      this.workers.push(slot);
    }
  }

  pumpQueue() {
    if (!this.workers.length) return;
    for (const slot of this.workers) {
      if (slot.busy) continue;
      const nextJob = this.queue.shift();
      if (!nextJob) return;
      if (nextJob.generation && this.cancelledGenerations.has(nextJob.generation)) {
        this.jobs.delete(nextJob.id);
        nextJob.resolve(null);
        continue;
      }
      slot.busy = true;
      slot.jobId = nextJob.id;
      slot.worker.postMessage(
        {
          id: nextJob.id,
          type: nextJob.type,
          payload: nextJob.payload,
        },
        Array.isArray(nextJob.transferList) ? nextJob.transferList : []
      );
    }
  }

  destroyPool() {
    this.workers.forEach((slot) => {
      try {
        slot.worker.terminate();
      } catch (_) {}
    });
    this.workers = [];
    if (this.url) {
      try {
        URL.revokeObjectURL(this.url);
      } catch (_) {}
    }
    this.url = null;
  }
}

export const templateWorkerManager = new TemplateWorkerManager();
