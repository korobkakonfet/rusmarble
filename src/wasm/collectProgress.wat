(module
  (memory (export "memory") 1)
  ;; collect_progress: compare each sample pixel against the live tile and accumulate
  ;; painted/missing/wrong counts per palette index.
  ;;
  ;; Result layout at resultPtr (pre-zeroed by caller):
  ;;   [0]  paintedCount   (i32)
  ;;   [4]  wrongCount     (i32)
  ;;   [8]  requiredCount  (i32)
  ;;   [12] paintedByIndex[0..paletteCount]             (i32 each, paletteCount+1 entries)
  ;;   [12+(paletteCount+1)*4] paintedAndEnabledByIndex (same count)
  ;;   [12+(paletteCount+1)*8] missingByIndex           (same count)
  ;;
  ;; Index paletteCount is the "OTHER" slot for colors not in the palette.
  ;;
  ;; missingMaskPtr (pre-zeroed by caller): Uint8Array[sampleCount]
  ;;   0     = painted or skipped pixel
  ;;   idx+1 = missing pixel whose palette index is idx (1-based)
  (func (export "collect_progress")
    ;; --- Sample arrays ---
    (param $sampleCount i32)
    (param $xPtr i32)        ;; Uint16Array (2 bytes/entry)
    (param $yPtr i32)        ;; Uint16Array (2 bytes/entry)
    (param $rPtr i32)        ;; Uint8Array
    (param $gPtr i32)        ;; Uint8Array
    (param $bPtr i32)        ;; Uint8Array
    (param $aPtr i32)        ;; Uint8Array
    (param $flagsPtr i32)    ;; Uint8Array (bit 0 = deface)
    ;; --- Live tile ---
    (param $liveTilePtr i32) ;; RGBA Uint8ClampedArray, tileSize*tileSize*4 bytes
    (param $tileSize i32)
    (param $offsetX i32)
    (param $offsetY i32)
    ;; --- Palette tables, each paletteCount entries ---
    (param $palettePackedPtr i32) ;; Uint32Array: packed RGB
    (param $paletteRPtr i32)      ;; Uint8Array: R
    (param $paletteGPtr i32)      ;; Uint8Array: G
    (param $paletteBPtr i32)      ;; Uint8Array: B
    (param $paletteCount i32)     ;; number of known paintable colors (e.g. 63)
    ;; --- Matching ---
    (param $colorMatchDelta i32)  ;; per-channel delta tolerance (e.g. 8)
    (param $templateEnabled i32)  ;; 1 = template active, 0 = inactive
    ;; --- Error map ---
    (param $errorDataPtr i32)         ;; RGBA buffer, or 0 to skip
    (param $errorWidth i32)           ;; error map width in pixels
    (param $errorMapOnlyEnabled i32)  ;; 1 = filter by displayedColors
    (param $displayedColorsPtr i32)   ;; Uint32Array of allowed packed colors
    (param $displayedColorsCount i32)
    (param $displayOther i32)         ;; 1 = include OTHER in error map when filtering
    ;; --- Output ---
    (param $resultPtr i32)       ;; pre-zeroed; see layout above
    (param $missingMaskPtr i32)  ;; pre-zeroed Uint8Array[sampleCount]

    (local $index i32)
    (local $localX i32)
    (local $localY i32)
    (local $pixelX i32)
    (local $pixelY i32)
    (local $templateR i32)
    (local $templateG i32)
    (local $templateB i32)
    (local $packedTemplate i32)
    (local $templatePaletteIndex i32)
    (local $palI i32)
    (local $paintedCount i32)
    (local $wrongCount i32)
    (local $requiredCount i32)
    (local $tileIndex i32)
    (local $liveR i32)
    (local $liveG i32)
    (local $liveB i32)
    (local $liveA i32)
    (local $shouldWriteError i32)
    (local $errorIndex i32)
    (local $isPainted i32)
    (local $tempDiff i32)
    (local $deltaR i32)
    (local $deltaG i32)
    (local $deltaB i32)
    (local $bestDist i32)
    (local $bestPacked i32)
    (local $dist i32)
    (local $paintedByIndexPtr i32)
    (local $paintedAndEnabledByIndexPtr i32)
    (local $missingByIndexPtr i32)
    (local $displayInError i32)
    (local $diI i32)
    (local $itemPtr i32)
    (local $slotCount i32)

    ;; slotCount = paletteCount + 1  (slot N = OTHER)
    (local.set $slotCount (i32.add (local.get $paletteCount) (i32.const 1)))

    ;; Base pointers for the three per-index arrays
    (local.set $paintedByIndexPtr
      (i32.add (local.get $resultPtr) (i32.const 12))
    )
    (local.set $paintedAndEnabledByIndexPtr
      (i32.add
        (local.get $paintedByIndexPtr)
        (i32.shl (local.get $slotCount) (i32.const 2))
      )
    )
    (local.set $missingByIndexPtr
      (i32.add
        (local.get $paintedAndEnabledByIndexPtr)
        (i32.shl (local.get $slotCount) (i32.const 2))
      )
    )

    ;; --- Main loop ---
    (local.set $index (i32.const 0))
    (block $loopEnd
      (loop $loop
        (br_if $loopEnd (i32.ge_u (local.get $index) (local.get $sampleCount)))
        (block $next

          ;; Skip transparent pixels
          (br_if $next
            (i32.lt_u
              (i32.load8_u (i32.add (local.get $aPtr) (local.get $index)))
              (i32.const 64)
            )
          )

          ;; Skip deface pixels (flag bit 0 set)
          (br_if $next
            (i32.and
              (i32.load8_u (i32.add (local.get $flagsPtr) (local.get $index)))
              (i32.const 1)
            )
          )

          ;; Load local x/y (Uint16 = 2 bytes each)
          (local.set $localX
            (i32.load16_u
              (i32.add (local.get $xPtr) (i32.shl (local.get $index) (i32.const 1)))
            )
          )
          (local.set $localY
            (i32.load16_u
              (i32.add (local.get $yPtr) (i32.shl (local.get $index) (i32.const 1)))
            )
          )
          (local.set $pixelX (i32.add (local.get $offsetX) (local.get $localX)))
          (local.set $pixelY (i32.add (local.get $offsetY) (local.get $localY)))

          ;; Bounds check
          (br_if $next
            (i32.or
              (i32.lt_s (local.get $pixelX) (i32.const 0))
              (i32.or
                (i32.ge_s (local.get $pixelX) (local.get $tileSize))
                (i32.or
                  (i32.lt_s (local.get $pixelY) (i32.const 0))
                  (i32.ge_s (local.get $pixelY) (local.get $tileSize))
                )
              )
            )
          )

          ;; Load template color
          (local.set $templateR (i32.load8_u (i32.add (local.get $rPtr) (local.get $index))))
          (local.set $templateG (i32.load8_u (i32.add (local.get $gPtr) (local.get $index))))
          (local.set $templateB (i32.load8_u (i32.add (local.get $bPtr) (local.get $index))))
          (local.set $packedTemplate
            (i32.or
              (i32.or
                (i32.shl (local.get $templateR) (i32.const 16))
                (i32.shl (local.get $templateG) (i32.const 8))
              )
              (local.get $templateB)
            )
          )

          ;; Find palette index for template color (linear scan; default = paletteCount = OTHER)
          (local.set $templatePaletteIndex (local.get $paletteCount))
          (local.set $palI (i32.const 0))
          (block $palFindEnd
            (loop $palFindLoop
              (br_if $palFindEnd (i32.ge_u (local.get $palI) (local.get $paletteCount)))
              (if
                (i32.eq
                  (i32.load
                    (i32.add
                      (local.get $palettePackedPtr)
                      (i32.shl (local.get $palI) (i32.const 2))
                    )
                  )
                  (local.get $packedTemplate)
                )
                (then
                  (local.set $templatePaletteIndex (local.get $palI))
                  (br $palFindEnd)
                )
              )
              (local.set $palI (i32.add (local.get $palI) (i32.const 1)))
              (br $palFindLoop)
            )
          )

          ;; requiredCount++
          (local.set $requiredCount (i32.add (local.get $requiredCount) (i32.const 1)))

          ;; Load live tile pixel
          (local.set $tileIndex
            (i32.shl
              (i32.add
                (i32.mul (local.get $pixelY) (local.get $tileSize))
                (local.get $pixelX)
              )
              (i32.const 2)
            )
          )
          (local.set $liveR
            (i32.load8_u (i32.add (local.get $liveTilePtr) (local.get $tileIndex)))
          )
          (local.set $liveG
            (i32.load8_u
              (i32.add (local.get $liveTilePtr) (i32.add (local.get $tileIndex) (i32.const 1)))
            )
          )
          (local.set $liveB
            (i32.load8_u
              (i32.add (local.get $liveTilePtr) (i32.add (local.get $tileIndex) (i32.const 2)))
            )
          )
          (local.set $liveA
            (i32.load8_u
              (i32.add (local.get $liveTilePtr) (i32.add (local.get $tileIndex) (i32.const 3)))
            )
          )

          ;; shouldWriteError = errorDataPtr != 0 && templateEnabled
          (local.set $shouldWriteError
            (i32.and
              (i32.ne (local.get $errorDataPtr) (i32.const 0))
              (local.get $templateEnabled)
            )
          )

          ;; When filtering by displayed colors, refine shouldWriteError
          (if (i32.and (local.get $shouldWriteError) (local.get $errorMapOnlyEnabled))
            (then
              (if (i32.eq (local.get $templatePaletteIndex) (local.get $paletteCount))
                (then
                  (local.set $shouldWriteError (local.get $displayOther))
                )
                (else
                  (local.set $displayInError (i32.const 0))
                  (local.set $diI (i32.const 0))
                  (block $diEnd
                    (loop $diLoop
                      (br_if $diEnd
                        (i32.ge_u (local.get $diI) (local.get $displayedColorsCount))
                      )
                      (if
                        (i32.eq
                          (i32.load
                            (i32.add
                              (local.get $displayedColorsPtr)
                              (i32.shl (local.get $diI) (i32.const 2))
                            )
                          )
                          (local.get $packedTemplate)
                        )
                        (then
                          (local.set $displayInError (i32.const 1))
                          (br $diEnd)
                        )
                      )
                      (local.set $diI (i32.add (local.get $diI) (i32.const 1)))
                      (br $diLoop)
                    )
                  )
                  (local.set $shouldWriteError (local.get $displayInError))
                )
              )
            )
          )

          ;; Compute error pixel offset (-1 when not writing)
          (local.set $errorIndex (i32.const -1))
          (if (local.get $shouldWriteError)
            (then
              (local.set $errorIndex
                (i32.shl
                  (i32.add
                    (i32.mul (local.get $localY) (local.get $errorWidth))
                    (local.get $localX)
                  )
                  (i32.const 2)
                )
              )
            )
          )

          ;; --- Match determination ---
          (local.set $isPainted (i32.const 0))

          (if (i32.lt_u (local.get $liveA) (i32.const 64))
            (then
              ;; Transparent live pixel — write gray error, isPainted stays 0
              (if (local.get $shouldWriteError)
                (then
                  (local.set $itemPtr
                    (i32.add (local.get $errorDataPtr) (local.get $errorIndex))
                  )
                  (i32.store8 (local.get $itemPtr) (i32.const 128))
                  (i32.store8 (i32.add (local.get $itemPtr) (i32.const 1)) (i32.const 128))
                  (i32.store8 (i32.add (local.get $itemPtr) (i32.const 2)) (i32.const 128))
                  (i32.store8 (i32.add (local.get $itemPtr) (i32.const 3)) (i32.const 200))
                )
              )
            )
            (else
              ;; Opaque live pixel — check exact / delta / palette-nearest
              (block $matchEnd

                ;; 1. Exact match
                (if
                  (i32.and
                    (i32.and
                      (i32.eq (local.get $liveR) (local.get $templateR))
                      (i32.eq (local.get $liveG) (local.get $templateG))
                    )
                    (i32.eq (local.get $liveB) (local.get $templateB))
                  )
                  (then
                    (local.set $isPainted (i32.const 1))
                    (br $matchEnd)
                  )
                )

                ;; Delta and palette-nearest only apply to known palette colors
                (br_if $matchEnd
                  (i32.eq (local.get $templatePaletteIndex) (local.get $paletteCount))
                )

                ;; 2. Delta/close match
                (local.set $tempDiff (i32.sub (local.get $liveR) (local.get $templateR)))
                (if (i32.lt_s (local.get $tempDiff) (i32.const 0))
                  (then (local.set $tempDiff (i32.sub (i32.const 0) (local.get $tempDiff))))
                )
                (local.set $deltaR (local.get $tempDiff))
                (local.set $tempDiff (i32.sub (local.get $liveG) (local.get $templateG)))
                (if (i32.lt_s (local.get $tempDiff) (i32.const 0))
                  (then (local.set $tempDiff (i32.sub (i32.const 0) (local.get $tempDiff))))
                )
                (local.set $deltaG (local.get $tempDiff))
                (local.set $tempDiff (i32.sub (local.get $liveB) (local.get $templateB)))
                (if (i32.lt_s (local.get $tempDiff) (i32.const 0))
                  (then (local.set $tempDiff (i32.sub (i32.const 0) (local.get $tempDiff))))
                )
                (local.set $deltaB (local.get $tempDiff))
                (if
                  (i32.and
                    (i32.and
                      (i32.le_u (local.get $deltaR) (local.get $colorMatchDelta))
                      (i32.le_u (local.get $deltaG) (local.get $colorMatchDelta))
                    )
                    (i32.le_u (local.get $deltaB) (local.get $colorMatchDelta))
                  )
                  (then
                    (local.set $isPainted (i32.const 1))
                    (br $matchEnd)
                  )
                )

                ;; 3. Palette-nearest match: find nearest paintable color for live pixel (L2)
                (local.set $bestDist (i32.const 0x7fffffff))
                (local.set $bestPacked (i32.const 0))
                (local.set $palI (i32.const 0))
                (block $nearestEnd
                  (loop $nearestLoop
                    (br_if $nearestEnd (i32.ge_u (local.get $palI) (local.get $paletteCount)))

                    (local.set $tempDiff
                      (i32.sub
                        (local.get $liveR)
                        (i32.load8_u (i32.add (local.get $paletteRPtr) (local.get $palI)))
                      )
                    )
                    (local.set $deltaR (i32.mul (local.get $tempDiff) (local.get $tempDiff)))

                    (local.set $tempDiff
                      (i32.sub
                        (local.get $liveG)
                        (i32.load8_u (i32.add (local.get $paletteGPtr) (local.get $palI)))
                      )
                    )
                    (local.set $deltaG (i32.mul (local.get $tempDiff) (local.get $tempDiff)))

                    (local.set $tempDiff
                      (i32.sub
                        (local.get $liveB)
                        (i32.load8_u (i32.add (local.get $paletteBPtr) (local.get $palI)))
                      )
                    )
                    (local.set $deltaB (i32.mul (local.get $tempDiff) (local.get $tempDiff)))

                    (local.set $dist
                      (i32.add
                        (i32.add (local.get $deltaR) (local.get $deltaG))
                        (local.get $deltaB)
                      )
                    )
                    (if (i32.lt_s (local.get $dist) (local.get $bestDist))
                      (then
                        (local.set $bestDist (local.get $dist))
                        (local.set $bestPacked
                          (i32.load
                            (i32.add
                              (local.get $palettePackedPtr)
                              (i32.shl (local.get $palI) (i32.const 2))
                            )
                          )
                        )
                        (br_if $nearestEnd (i32.eqz (local.get $dist)))
                      )
                    )
                    (local.set $palI (i32.add (local.get $palI) (i32.const 1)))
                    (br $nearestLoop)
                  )
                )

                (if (i32.eq (local.get $bestPacked) (local.get $packedTemplate))
                  (then (local.set $isPainted (i32.const 1)))
                )

              ) ;; end $matchEnd

              ;; Update counts based on match result
              (if (local.get $isPainted)
                (then
                  ;; Painted: update totals and per-index arrays
                  (local.set $paintedCount (i32.add (local.get $paintedCount) (i32.const 1)))

                  (local.set $itemPtr
                    (i32.add
                      (local.get $paintedByIndexPtr)
                      (i32.shl (local.get $templatePaletteIndex) (i32.const 2))
                    )
                  )
                  (i32.store (local.get $itemPtr)
                    (i32.add (i32.load (local.get $itemPtr)) (i32.const 1))
                  )

                  (local.set $itemPtr
                    (i32.add
                      (local.get $paintedAndEnabledByIndexPtr)
                      (i32.shl (local.get $templatePaletteIndex) (i32.const 2))
                    )
                  )
                  (i32.store (local.get $itemPtr)
                    (i32.add (i32.load (local.get $itemPtr)) (local.get $templateEnabled))
                  )

                  ;; Green error
                  (if (local.get $shouldWriteError)
                    (then
                      (local.set $itemPtr
                        (i32.add (local.get $errorDataPtr) (local.get $errorIndex))
                      )
                      (i32.store8 (local.get $itemPtr) (i32.const 0))
                      (i32.store8 (i32.add (local.get $itemPtr) (i32.const 1)) (i32.const 128))
                      (i32.store8 (i32.add (local.get $itemPtr) (i32.const 2)) (i32.const 0))
                      (i32.store8 (i32.add (local.get $itemPtr) (i32.const 3)) (i32.const 160))
                    )
                  )
                )
                (else
                  ;; Wrong color: wrongCount++, red error
                  (local.set $wrongCount (i32.add (local.get $wrongCount) (i32.const 1)))
                  (if (local.get $shouldWriteError)
                    (then
                      (local.set $itemPtr
                        (i32.add (local.get $errorDataPtr) (local.get $errorIndex))
                      )
                      (i32.store8 (local.get $itemPtr) (i32.const 255))
                      (i32.store8 (i32.add (local.get $itemPtr) (i32.const 1)) (i32.const 0))
                      (i32.store8 (i32.add (local.get $itemPtr) (i32.const 2)) (i32.const 0))
                      (i32.store8 (i32.add (local.get $itemPtr) (i32.const 3)) (i32.const 224))
                    )
                  )
                )
              )
            )
          ) ;; end liveA < 64 check

          ;; Missing pixel: update missingByIndex and write to missingMask
          (if (i32.eqz (local.get $isPainted))
            (then
              (local.set $itemPtr
                (i32.add
                  (local.get $missingByIndexPtr)
                  (i32.shl (local.get $templatePaletteIndex) (i32.const 2))
                )
              )
              (i32.store (local.get $itemPtr)
                (i32.add (i32.load (local.get $itemPtr)) (i32.const 1))
              )
              ;; missingMask[index] = paletteIndex + 1  (1-based so 0 stays "not missing")
              (i32.store8
                (i32.add (local.get $missingMaskPtr) (local.get $index))
                (i32.add (local.get $templatePaletteIndex) (i32.const 1))
              )
            )
          )

        ) ;; end $next
        (local.set $index (i32.add (local.get $index) (i32.const 1)))
        (br $loop)
      )
    )

    ;; Write aggregate totals
    (i32.store (local.get $resultPtr) (local.get $paintedCount))
    (i32.store (i32.add (local.get $resultPtr) (i32.const 4)) (local.get $wrongCount))
    (i32.store (i32.add (local.get $resultPtr) (i32.const 8)) (local.get $requiredCount))
  )
)
