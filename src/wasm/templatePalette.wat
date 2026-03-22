(module
  (memory (export "memory") 1)
  (func (export "convert_pixels")
    (param $dataPtr i32)
    (param $pixelCount i32)
    (param $alphaThreshold i32)
    (param $palettePtr i32)
    (param $paletteCount i32)
    (param $distanceMode i32)
    (result i32)
    (local $index i32)
    (local $pixelPtr i32)
    (local $r i32)
    (local $g i32)
    (local $b i32)
    (local $a i32)
    (local $paletteIndex i32)
    (local $paletteItemPtr i32)
    (local $pr i32)
    (local $pg i32)
    (local $pb i32)
    (local $dr i32)
    (local $dg i32)
    (local $db i32)
    (local $distance i32)
    (local $bestDistance i32)
    (local $bestR i32)
    (local $bestG i32)
    (local $bestB i32)
    (local $convertedCount i32)

    (local.set $index (i32.const 0))
    (local.set $convertedCount (i32.const 0))

    (block $outerEnd
      (loop $outerLoop
        (br_if $outerEnd (i32.ge_u (local.get $index) (local.get $pixelCount)))

        (local.set $pixelPtr
          (i32.add
            (local.get $dataPtr)
            (i32.shl (local.get $index) (i32.const 2))
          )
        )
        (local.set $a
          (i32.load8_u (i32.add (local.get $pixelPtr) (i32.const 3)))
        )

        (if
          (i32.lt_u (local.get $a) (local.get $alphaThreshold))
          (then
            (i32.store8 (i32.add (local.get $pixelPtr) (i32.const 3)) (i32.const 0))
            (local.set $index (i32.add (local.get $index) (i32.const 1)))
            (br $outerLoop)
          )
        )

        (local.set $r (i32.load8_u (local.get $pixelPtr)))
        (local.set $g (i32.load8_u (i32.add (local.get $pixelPtr) (i32.const 1))))
        (local.set $b (i32.load8_u (i32.add (local.get $pixelPtr) (i32.const 2))))
        (local.set $bestDistance (i32.const 2147483647))
        (local.set $bestR (local.get $r))
        (local.set $bestG (local.get $g))
        (local.set $bestB (local.get $b))
        (local.set $paletteIndex (i32.const 0))

        (block $paletteEnd
          (loop $paletteLoop
            (br_if $paletteEnd (i32.ge_u (local.get $paletteIndex) (local.get $paletteCount)))

            (local.set $paletteItemPtr
              (i32.add
                (local.get $palettePtr)
                (i32.shl (local.get $paletteIndex) (i32.const 2))
              )
            )
            (local.set $pr (i32.load8_u (local.get $paletteItemPtr)))
            (local.set $pg (i32.load8_u (i32.add (local.get $paletteItemPtr) (i32.const 1))))
            (local.set $pb (i32.load8_u (i32.add (local.get $paletteItemPtr) (i32.const 2))))

            (if
              (i32.and
                (i32.and
                  (i32.eq (local.get $r) (local.get $pr))
                  (i32.eq (local.get $g) (local.get $pg))
                )
                (i32.eq (local.get $b) (local.get $pb))
              )
              (then
                (local.set $bestDistance (i32.const 0))
                (local.set $bestR (local.get $pr))
                (local.set $bestG (local.get $pg))
                (local.set $bestB (local.get $pb))
                (br $paletteEnd)
              )
            )

            (local.set $dr (i32.sub (local.get $r) (local.get $pr)))
            (local.set $dg (i32.sub (local.get $g) (local.get $pg)))
            (local.set $db (i32.sub (local.get $b) (local.get $pb)))

            (if
              (i32.eqz (local.get $distanceMode))
              (then
                (local.set $distance
                  (i32.add
                    (i32.add
                      (i32.mul (local.get $dr) (local.get $dr))
                      (i32.mul (local.get $dg) (local.get $dg))
                    )
                    (i32.mul (local.get $db) (local.get $db))
                  )
                )
              )
              (else
                (local.set $distance
                  (i32.add
                    (i32.add
                      (i32.mul
                        (i32.mul (local.get $dr) (local.get $dr))
                        (i32.const 2126)
                      )
                      (i32.mul
                        (i32.mul (local.get $dg) (local.get $dg))
                        (i32.const 7152)
                      )
                    )
                    (i32.mul
                      (i32.mul (local.get $db) (local.get $db))
                      (i32.const 722)
                    )
                  )
                )
              )
            )

            (if
              (i32.lt_s (local.get $distance) (local.get $bestDistance))
              (then
                (local.set $bestDistance (local.get $distance))
                (local.set $bestR (local.get $pr))
                (local.set $bestG (local.get $pg))
                (local.set $bestB (local.get $pb))
              )
            )

            (local.set $paletteIndex (i32.add (local.get $paletteIndex) (i32.const 1)))
            (br $paletteLoop)
          )
        )

        (if
          (i32.ne (local.get $bestDistance) (i32.const 0))
          (then
            (i32.store8 (local.get $pixelPtr) (local.get $bestR))
            (i32.store8 (i32.add (local.get $pixelPtr) (i32.const 1)) (local.get $bestG))
            (i32.store8 (i32.add (local.get $pixelPtr) (i32.const 2)) (local.get $bestB))
            (local.set $convertedCount (i32.add (local.get $convertedCount) (i32.const 1)))
          )
        )

        (local.set $index (i32.add (local.get $index) (i32.const 1)))
        (br $outerLoop)
      )
    )

    (local.get $convertedCount)
  )
)
