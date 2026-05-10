(module
  (memory (export "memory") 1)

  ;; Binary search in a sorted Uint32 array.
  ;; Returns 1 if target is present, 0 otherwise.
  (func $binary_search
    (param $arrPtr i32) (param $len i32) (param $target i32)
    (result i32)
    (local $lo i32) (local $hi i32) (local $mid i32) (local $val i32)
    (local.set $hi (local.get $len))
    (block $done
      (loop $search
        (br_if $done (i32.ge_u (local.get $lo) (local.get $hi)))
        (local.set $mid (i32.shr_u (i32.add (local.get $lo) (local.get $hi)) (i32.const 1)))
        (local.set $val
          (i32.load
            (i32.add (local.get $arrPtr)
              (i32.shl (local.get $mid) (i32.const 2)))))
        (if (i32.eq (local.get $val) (local.get $target))
          (then (return (i32.const 1))))
        (if (i32.lt_u (local.get $val) (local.get $target))
          (then (local.set $lo (i32.add (local.get $mid) (i32.const 1))))
          (else (local.set $hi (local.get $mid))))
        (br $search)
      )
    )
    (i32.const 0)
  )

  ;; filter_bitmap_pixels
  ;;
  ;; For each mask point and each logical shread pixel, reads the template RGBA
  ;; value and, if its packed color is allowed, copies it to the result buffer.
  ;; Result buffer must be pre-zeroed by the caller.
  ;;
  ;; Parameters:
  ;;   templatePtr         - Uint8Array: templateWidth*templateHeight*4 RGBA bytes
  ;;   resultPtr           - Uint8Array: resultWidth*resultHeight*4 RGBA bytes (pre-zeroed)
  ;;   templateWidth       - template image width in pixels
  ;;   templateHeight      - template image height in pixels
  ;;   resultWidth         - result image width in pixels
  ;;   drawMultTemplate    - stride in template pixels per logical pixel (shreadSize)
  ;;   drawMultResult      - stride in result pixels per logical pixel
  ;;   drawMultCenter      - (shreadSize-1)>>1, offset to the center sample
  ;;   maskPointsPtr       - Int32Array: [offsetX0, offsetY0, offsetX1, offsetY1, ...]
  ;;   maskCount           - number of mask points (pairs / 2)
  ;;   dispColorsPtr       - Uint32Array: sorted allowed packed colors
  ;;   dispColorsLen       - length of dispColors array
  ;;   knownColorsPtr      - Uint32Array: sorted known-palette packed colors
  ;;   knownColorsLen      - length of knownColors array
  ;;   displayOther        - 1 to render colors NOT in knownColors, 0 otherwise
  (func (export "filter_bitmap_pixels")
    (param $templatePtr i32)
    (param $resultPtr i32)
    (param $templateWidth i32)
    (param $templateHeight i32)
    (param $resultWidth i32)
    (param $drawMultTemplate i32)
    (param $drawMultResult i32)
    (param $drawMultCenter i32)
    (param $maskPointsPtr i32)
    (param $maskCount i32)
    (param $dispColorsPtr i32)
    (param $dispColorsLen i32)
    (param $knownColorsPtr i32)
    (param $knownColorsLen i32)
    (param $displayOther i32)

    (local $mi i32)
    (local $mpOffset i32)
    (local $offsetX i32) (local $offsetY i32)
    (local $templateRowBase i32) (local $resultRowBase i32)
    (local $templatePixelPtr i32) (local $resultPixelPtr i32)
    (local $yt i32)
    (local $xt i32)
    (local $R i32) (local $G i32) (local $B i32) (local $A i32)
    (local $packed i32)
    (local $shouldRender i32)
    (local $templateRowStep i32)
    (local $resultRowStep i32)
    (local $templateColStep i32)
    (local $resultColStep i32)
    (local $templateCenterRowBase i32)

    ;; Precompute per-row and per-col strides (in bytes).
    ;; templateRowStep = templateWidth * drawMultTemplate * 4
    (local.set $templateRowStep
      (i32.shl (i32.mul (local.get $templateWidth) (local.get $drawMultTemplate)) (i32.const 2)))
    ;; resultRowStep = resultWidth * drawMultResult * 4
    (local.set $resultRowStep
      (i32.shl (i32.mul (local.get $resultWidth) (local.get $drawMultResult)) (i32.const 2)))
    ;; templateColStep = drawMultTemplate * 4
    (local.set $templateColStep (i32.shl (local.get $drawMultTemplate) (i32.const 2)))
    ;; resultColStep = drawMultResult * 4
    (local.set $resultColStep (i32.shl (local.get $drawMultResult) (i32.const 2)))

    ;; templateCenterRowBase = drawMultCenter * templateWidth * 4  (first template row offset)
    (local.set $templateCenterRowBase
      (i32.shl (i32.mul (local.get $drawMultCenter) (local.get $templateWidth)) (i32.const 2)))

    ;; Outer loop: mask points
    (block $maskDone
      (loop $maskLoop
        (br_if $maskDone (i32.ge_u (local.get $mi) (local.get $maskCount)))

        ;; mpOffset = mi * 8  (each entry is 2 × i32 = 8 bytes)
        (local.set $mpOffset (i32.shl (local.get $mi) (i32.const 3)))
        (local.set $offsetX (i32.load (i32.add (local.get $maskPointsPtr) (local.get $mpOffset))))
        (local.set $offsetY (i32.load (i32.add (local.get $maskPointsPtr) (i32.add (local.get $mpOffset) (i32.const 4)))))

        ;; templateRowBase starts at first sampled row: drawMultCenter * templateWidth * 4
        (local.set $templateRowBase (local.get $templateCenterRowBase))
        ;; resultRowBase starts at: offsetY * resultWidth * 4
        (local.set $resultRowBase
          (i32.shl (i32.mul (local.get $offsetY) (local.get $resultWidth)) (i32.const 2)))

        ;; Row loop: yt from drawMultCenter to templateHeight, step drawMultTemplate
        (local.set $yt (local.get $drawMultCenter))
        (block $rowDone
          (loop $rowLoop
            (br_if $rowDone (i32.ge_u (local.get $yt) (local.get $templateHeight)))

            ;; templatePixelPtr = templatePtr + templateRowBase + drawMultCenter * 4
            (local.set $templatePixelPtr
              (i32.add
                (i32.add (local.get $templatePtr) (local.get $templateRowBase))
                (i32.shl (local.get $drawMultCenter) (i32.const 2))))
            ;; resultPixelPtr = resultPtr + resultRowBase + offsetX * 4
            (local.set $resultPixelPtr
              (i32.add
                (i32.add (local.get $resultPtr) (local.get $resultRowBase))
                (i32.shl (local.get $offsetX) (i32.const 2))))

            ;; Col loop: xt from drawMultCenter to templateWidth, step drawMultTemplate
            (local.set $xt (local.get $drawMultCenter))
            (block $colDone
              (loop $colLoop
                (br_if $colDone (i32.ge_u (local.get $xt) (local.get $templateWidth)))

                ;; Read RGBA
                (local.set $R (i32.load8_u (local.get $templatePixelPtr)))
                (local.set $G (i32.load8_u (i32.add (local.get $templatePixelPtr) (i32.const 1))))
                (local.set $B (i32.load8_u (i32.add (local.get $templatePixelPtr) (i32.const 2))))
                (local.set $A (i32.load8_u (i32.add (local.get $templatePixelPtr) (i32.const 3))))

                (block $skipPixel
                  ;; Skip fully transparent pixels
                  (br_if $skipPixel (i32.lt_u (local.get $A) (i32.const 1)))

                  ;; packed = (R << 16) | (G << 8) | B
                  (local.set $packed
                    (i32.or
                      (i32.or
                        (i32.shl (local.get $R) (i32.const 16))
                        (i32.shl (local.get $G) (i32.const 8)))
                      (local.get $B)))

                  ;; Check if packed is in displayed colors
                  (local.set $shouldRender
                    (call $binary_search
                      (local.get $dispColorsPtr) (local.get $dispColorsLen) (local.get $packed)))

                  ;; If not found and displayOther: render if NOT in known palette
                  (if (i32.and (i32.eqz (local.get $shouldRender)) (local.get $displayOther))
                    (then
                      (local.set $shouldRender
                        (i32.eqz
                          (call $binary_search
                            (local.get $knownColorsPtr) (local.get $knownColorsLen) (local.get $packed))))))

                  ;; Write pixel to result
                  (if (local.get $shouldRender)
                    (then
                      (i32.store8 (local.get $resultPixelPtr) (local.get $R))
                      (i32.store8 (i32.add (local.get $resultPixelPtr) (i32.const 1)) (local.get $G))
                      (i32.store8 (i32.add (local.get $resultPixelPtr) (i32.const 2)) (local.get $B))
                      (i32.store8 (i32.add (local.get $resultPixelPtr) (i32.const 3)) (local.get $A))))
                )

                ;; Advance column pointers
                (local.set $templatePixelPtr (i32.add (local.get $templatePixelPtr) (local.get $templateColStep)))
                (local.set $resultPixelPtr (i32.add (local.get $resultPixelPtr) (local.get $resultColStep)))
                (local.set $xt (i32.add (local.get $xt) (local.get $drawMultTemplate)))
                (br $colLoop)
              )
            )

            ;; Advance row bases
            (local.set $templateRowBase (i32.add (local.get $templateRowBase) (local.get $templateRowStep)))
            (local.set $resultRowBase (i32.add (local.get $resultRowBase) (local.get $resultRowStep)))
            (local.set $yt (i32.add (local.get $yt) (local.get $drawMultTemplate)))
            (br $rowLoop)
          )
        )

        (local.set $mi (i32.add (local.get $mi) (i32.const 1)))
        (br $maskLoop)
      )
    )
  )
)
