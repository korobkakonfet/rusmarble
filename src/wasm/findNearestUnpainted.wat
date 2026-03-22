(module
  (memory (export "memory") 1)
  (func (export "find_nearest")
    (param $sampleCount i32)
    (param $xPtr i32)
    (param $yPtr i32)
    (param $rPtr i32)
    (param $gPtr i32)
    (param $bPtr i32)
    (param $aPtr i32)
    (param $flagsPtr i32)
    (param $liveTilePtr i32)
    (param $tileSize i32)
    (param $offsetX i32)
    (param $offsetY i32)
    (param $originWorldX i32)
    (param $originWorldY i32)
    (param $tileX i32)
    (param $tileY i32)
    (param $worldWidth i32)
    (param $colorMatchDelta i32)
    (param $excludedPixelX i32)
    (param $excludedPixelY i32)
    (param $allowedColorPtr i32)
    (param $allowedColorCount i32)
    (param $resultPtr i32)
    (local $index i32)
    (local $pixelX i32)
    (local $pixelY i32)
    (local $templateR i32)
    (local $templateG i32)
    (local $templateB i32)
    (local $liveR i32)
    (local $liveG i32)
    (local $liveB i32)
    (local $liveA i32)
    (local $tileIndex i32)
    (local $packedTemplateColor i32)
    (local $allowedIndex i32)
    (local $isAllowedColor i32)
    (local $tempDiff i32)
    (local $deltaR i32)
    (local $deltaG i32)
    (local $deltaB i32)
    (local $targetWorldX i32)
    (local $targetWorldY i32)
    (local $wrappedDx i32)
    (local $dy i32)
    (local $distance f64)
    (local $bestDistance f64)
    (local $bestPixelX i32)
    (local $bestPixelY i32)
    (local $found i32)

    (local.set $index (i32.const 0))
    (local.set $bestDistance (f64.const 1e300))
    (local.set $bestPixelX (i32.const 0))
    (local.set $bestPixelY (i32.const 0))
    (local.set $found (i32.const 0))

    (block $scanEnd
      (loop $scanLoop
        (br_if $scanEnd (i32.ge_u (local.get $index) (local.get $sampleCount)))
        (block $scanContinue
          (br_if $scanContinue
            (i32.lt_u
              (i32.load8_u (i32.add (local.get $aPtr) (local.get $index)))
              (i32.const 64)
            )
          )
          (br_if $scanContinue
            (i32.ne
              (i32.and
                (i32.load8_u (i32.add (local.get $flagsPtr) (local.get $index)))
                (i32.const 1)
              )
              (i32.const 0)
            )
          )

          (local.set $pixelX
            (i32.add
              (local.get $offsetX)
              (i32.load16_u
                (i32.add
                  (local.get $xPtr)
                  (i32.shl (local.get $index) (i32.const 1))
                )
              )
            )
          )
          (local.set $pixelY
            (i32.add
              (local.get $offsetY)
              (i32.load16_u
                (i32.add
                  (local.get $yPtr)
                  (i32.shl (local.get $index) (i32.const 1))
                )
              )
            )
          )

          (br_if $scanContinue
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

          (local.set $templateR (i32.load8_u (i32.add (local.get $rPtr) (local.get $index))))
          (local.set $templateG (i32.load8_u (i32.add (local.get $gPtr) (local.get $index))))
          (local.set $templateB (i32.load8_u (i32.add (local.get $bPtr) (local.get $index))))
          (local.set $packedTemplateColor
            (i32.or
              (i32.or
                (i32.shl (local.get $templateR) (i32.const 16))
                (i32.shl (local.get $templateG) (i32.const 8))
              )
              (local.get $templateB)
            )
          )

          (local.set $isAllowedColor (i32.const 0))
          (local.set $allowedIndex (i32.const 0))
          (block $allowedEnd
            (loop $allowedLoop
              (br_if $allowedEnd (i32.ge_u (local.get $allowedIndex) (local.get $allowedColorCount)))
              (if
                (i32.eq
                  (i32.load
                    (i32.add
                      (local.get $allowedColorPtr)
                      (i32.shl (local.get $allowedIndex) (i32.const 2))
                    )
                  )
                  (local.get $packedTemplateColor)
                )
                (then
                  (local.set $isAllowedColor (i32.const 1))
                  (br $allowedEnd)
                )
              )
              (local.set $allowedIndex (i32.add (local.get $allowedIndex) (i32.const 1)))
              (br $allowedLoop)
            )
          )
          (br_if $scanContinue (i32.eqz (local.get $isAllowedColor)))

          (local.set $tileIndex
            (i32.add
              (local.get $liveTilePtr)
              (i32.shl
                (i32.add
                  (i32.mul (local.get $pixelY) (local.get $tileSize))
                  (local.get $pixelX)
                )
                (i32.const 2)
              )
            )
          )
          (local.set $liveA (i32.load8_u (i32.add (local.get $tileIndex) (i32.const 3))))
          (local.set $liveR (i32.load8_u (local.get $tileIndex)))
          (local.set $liveG (i32.load8_u (i32.add (local.get $tileIndex) (i32.const 1))))
          (local.set $liveB (i32.load8_u (i32.add (local.get $tileIndex) (i32.const 2))))

          (if
            (i32.ge_u (local.get $liveA) (i32.const 64))
            (then
              (if
                (i32.and
                  (i32.and
                    (i32.eq (local.get $liveR) (local.get $templateR))
                    (i32.eq (local.get $liveG) (local.get $templateG))
                  )
                  (i32.eq (local.get $liveB) (local.get $templateB))
                )
                (then (br $scanContinue))
              )

              (local.set $tempDiff (i32.sub (local.get $liveR) (local.get $templateR)))
              (if
                (i32.lt_s (local.get $tempDiff) (i32.const 0))
                (then (local.set $tempDiff (i32.sub (i32.const 0) (local.get $tempDiff))))
              )
              (local.set $deltaR (local.get $tempDiff))

              (local.set $tempDiff (i32.sub (local.get $liveG) (local.get $templateG)))
              (if
                (i32.lt_s (local.get $tempDiff) (i32.const 0))
                (then (local.set $tempDiff (i32.sub (i32.const 0) (local.get $tempDiff))))
              )
              (local.set $deltaG (local.get $tempDiff))

              (local.set $tempDiff (i32.sub (local.get $liveB) (local.get $templateB)))
              (if
                (i32.lt_s (local.get $tempDiff) (i32.const 0))
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
                (then (br $scanContinue))
              )
            )
          )

          (br_if $scanContinue
            (i32.and
              (i32.eq (local.get $pixelX) (local.get $excludedPixelX))
              (i32.eq (local.get $pixelY) (local.get $excludedPixelY))
            )
          )

          (local.set $targetWorldX
            (i32.add
              (i32.mul (local.get $tileX) (local.get $tileSize))
              (local.get $pixelX)
            )
          )
          (local.set $targetWorldY
            (i32.add
              (i32.mul (local.get $tileY) (local.get $tileSize))
              (local.get $pixelY)
            )
          )
          (local.set $wrappedDx
            (i32.sub (local.get $targetWorldX) (local.get $originWorldX))
          )
          (local.set $wrappedDx
            (i32.rem_s
              (i32.add
                (i32.rem_s (local.get $wrappedDx) (local.get $worldWidth))
                (local.get $worldWidth)
              )
              (local.get $worldWidth)
            )
          )
          (if
            (i32.gt_s
              (local.get $wrappedDx)
              (i32.div_s (local.get $worldWidth) (i32.const 2))
            )
            (then
              (local.set $wrappedDx
                (i32.sub (local.get $wrappedDx) (local.get $worldWidth))
              )
            )
          )
          (local.set $dy (i32.sub (local.get $targetWorldY) (local.get $originWorldY)))
          (local.set $distance
            (f64.add
              (f64.mul
                (f64.convert_i32_s (local.get $wrappedDx))
                (f64.convert_i32_s (local.get $wrappedDx))
              )
              (f64.mul
                (f64.convert_i32_s (local.get $dy))
                (f64.convert_i32_s (local.get $dy))
              )
            )
          )

          (if
            (f64.lt (local.get $distance) (local.get $bestDistance))
            (then
              (local.set $bestDistance (local.get $distance))
              (local.set $bestPixelX (local.get $pixelX))
              (local.set $bestPixelY (local.get $pixelY))
              (local.set $found (i32.const 1))
            )
          )
        )
        (local.set $index (i32.add (local.get $index) (i32.const 1)))
        (br $scanLoop)
      )
    )

    (i32.store (local.get $resultPtr) (local.get $found))
    (i32.store (i32.add (local.get $resultPtr) (i32.const 4)) (local.get $bestPixelX))
    (i32.store (i32.add (local.get $resultPtr) (i32.const 8)) (local.get $bestPixelY))
    (f64.store (i32.add (local.get $resultPtr) (i32.const 16)) (local.get $bestDistance))
  )
)
