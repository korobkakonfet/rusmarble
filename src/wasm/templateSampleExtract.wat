(module
  (memory (export "memory") 1)
  (func (export "extract_samples")
    (param $sourcePtr i32)
    (param $imageWidth i32)
    (param $sourceX i32)
    (param $sourceY i32)
    (param $chunkWidth i32)
    (param $chunkHeight i32)
    (param $xPtr i32)
    (param $yPtr i32)
    (param $rPtr i32)
    (param $gPtr i32)
    (param $bPtr i32)
    (param $aPtr i32)
    (param $flagsPtr i32)
    (param $palettePtr i32)
    (param $paletteCount i32)
    (param $paletteCountsPtr i32)
    (param $statsPtr i32)
    (result i32)
    (local $writeIndex i32)
    (local $y i32)
    (local $x i32)
    (local $pixelIndex i32)
    (local $pixelPtr i32)
    (local $packedColor i32)
    (local $paletteIndex i32)
    (local $palettePacked i32)
    (local $required i32)
    (local $deface i32)
    (local $hasOther i32)
    (local $red i32)
    (local $green i32)
    (local $blue i32)
    (local $alpha i32)
    (local $flag i32)
    (local $countsEntryPtr i32)

    (local.set $writeIndex (i32.const 0))
    (local.set $required (i32.const 0))
    (local.set $deface (i32.const 0))
    (local.set $hasOther (i32.const 0))
    (local.set $y (i32.const 0))

    (block $rowsEnd
      (loop $rowsLoop
        (br_if $rowsEnd (i32.ge_u (local.get $y) (local.get $chunkHeight)))
        (local.set $x (i32.const 0))

        (block $colsEnd
          (loop $colsLoop
            (br_if $colsEnd (i32.ge_u (local.get $x) (local.get $chunkWidth)))

            (local.set $pixelIndex
              (i32.add
                (i32.mul
                  (i32.add (local.get $sourceY) (local.get $y))
                  (local.get $imageWidth)
                )
                (i32.add (local.get $sourceX) (local.get $x))
              )
            )
            (local.set $pixelPtr
              (i32.add
                (local.get $sourcePtr)
                (i32.shl (local.get $pixelIndex) (i32.const 2))
              )
            )
            (local.set $alpha (i32.load8_u (i32.add (local.get $pixelPtr) (i32.const 3))))

            (if
              (i32.gt_u (local.get $alpha) (i32.const 0))
              (then
                (local.set $red (i32.load8_u (local.get $pixelPtr)))
                (local.set $green (i32.load8_u (i32.add (local.get $pixelPtr) (i32.const 1))))
                (local.set $blue (i32.load8_u (i32.add (local.get $pixelPtr) (i32.const 2))))
                (local.set $packedColor
                  (i32.or
                    (i32.or
                      (i32.shl (local.get $red) (i32.const 16))
                      (i32.shl (local.get $green) (i32.const 8))
                    )
                    (local.get $blue)
                  )
                )
                (local.set $flag (i32.const 0))
                (if
                  (i32.eq (local.get $packedColor) (i32.const 14613198))
                  (then
                    (local.set $flag (i32.const 1))
                  )
                )

                (i32.store16
                  (i32.add
                    (local.get $xPtr)
                    (i32.shl (local.get $writeIndex) (i32.const 1))
                  )
                  (local.get $x)
                )
                (i32.store16
                  (i32.add
                    (local.get $yPtr)
                    (i32.shl (local.get $writeIndex) (i32.const 1))
                  )
                  (local.get $y)
                )
                (i32.store8 (i32.add (local.get $rPtr) (local.get $writeIndex)) (local.get $red))
                (i32.store8 (i32.add (local.get $gPtr) (local.get $writeIndex)) (local.get $green))
                (i32.store8 (i32.add (local.get $bPtr) (local.get $writeIndex)) (local.get $blue))
                (i32.store8 (i32.add (local.get $aPtr) (local.get $writeIndex)) (local.get $alpha))
                (i32.store8 (i32.add (local.get $flagsPtr) (local.get $writeIndex)) (local.get $flag))

                (if
                  (i32.and
                    (i32.gt_u (local.get $paletteCount) (i32.const 0))
                    (i32.ge_u (local.get $alpha) (i32.const 64))
                  )
                  (then
                    (if
                      (i32.eq (local.get $flag) (i32.const 1))
                      (then
                        (local.set $deface (i32.add (local.get $deface) (i32.const 1)))
                      )
                      (else
                        (local.set $required (i32.add (local.get $required) (i32.const 1)))
                        (local.set $paletteIndex (i32.const 0))
                        (block $paletteEnd
                          (loop $paletteLoop
                            (br_if $paletteEnd (i32.ge_u (local.get $paletteIndex) (local.get $paletteCount)))
                            (local.set $palettePacked
                              (i32.load
                                (i32.add
                                  (local.get $palettePtr)
                                  (i32.shl (local.get $paletteIndex) (i32.const 2))
                                )
                              )
                            )
                            (if
                              (i32.eq (local.get $packedColor) (local.get $palettePacked))
                              (then
                                (local.set $countsEntryPtr
                                  (i32.add
                                    (local.get $paletteCountsPtr)
                                    (i32.shl (local.get $paletteIndex) (i32.const 2))
                                  )
                                )
                                (i32.store
                                  (local.get $countsEntryPtr)
                                  (i32.add
                                    (i32.load (local.get $countsEntryPtr))
                                    (i32.const 1)
                                  )
                                )
                                (br $paletteEnd)
                              )
                            )
                            (local.set $paletteIndex (i32.add (local.get $paletteIndex) (i32.const 1)))
                            (br $paletteLoop)
                          )
                        )
                        (if
                          (i32.eq (local.get $paletteIndex) (local.get $paletteCount))
                          (then
                            (local.set $hasOther (i32.const 1))
                            (local.set $countsEntryPtr
                              (i32.add
                                (local.get $paletteCountsPtr)
                                (i32.shl (local.get $paletteCount) (i32.const 2))
                              )
                            )
                            (i32.store
                              (local.get $countsEntryPtr)
                              (i32.add
                                (i32.load (local.get $countsEntryPtr))
                                (i32.const 1)
                              )
                            )
                          )
                        )
                      )
                    )
                  )
                )

                (local.set $writeIndex (i32.add (local.get $writeIndex) (i32.const 1)))
              )
            )

            (local.set $x (i32.add (local.get $x) (i32.const 1)))
            (br $colsLoop)
          )
        )

        (local.set $y (i32.add (local.get $y) (i32.const 1)))
        (br $rowsLoop)
      )
    )

    (if
      (i32.gt_u (local.get $paletteCount) (i32.const 0))
      (then
        (i32.store (local.get $statsPtr) (local.get $required))
        (i32.store (i32.add (local.get $statsPtr) (i32.const 4)) (local.get $deface))
        (i32.store (i32.add (local.get $statsPtr) (i32.const 8)) (local.get $hasOther))
      )
    )

    (local.get $writeIndex)
  )
)
