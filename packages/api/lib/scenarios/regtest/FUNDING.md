# Test Vector Funding Targets (regtest)

Generated from 59 scenarios: 38 anchor their own beacons, 12 are cohort members (one shared anchor per cohort), 9 need no funding.

## Solo beacon addresses

Each address carries one OP_RETURN per anchor. Fund each address once; the anchor step chains the change.

| Address | Type | Anchors | Scenarios |
|---------|------|---------|-----------|
| `n4PmTdLkRhxnreFzW2cKE3hYrWmmratT2P` | p2pkh | 1 | 02-k1-sidecar-update |
| `mmS49Jsg6Yf4Arc16Eie2wWJei61x7Gey5` | p2pkh | 1 | 04-x1-sidecar-update |
| `bcrt1quhdgr52jrtnx7g9t5c4y9zyrz0rvjppdkakl00` | p2wpkh | 3 | 06-x1-cas-3-updates |
| `n3fnKAdm8pTGb9oGyeLAdSnJSMu6dvTPy8` | p2pkh | 1 | 07-k1-sidecar-deactivate |
| `bcrt1qfvtnzgdj5jg86eea278kc8ggzwnw7qaysru4jz` | p2wpkh | 2 | 08-x1-cas-update-deactivate |
| `bcrt1q6vz70rnr2d4c3msw2h54vpwelc5hxdh0f4ny2k` | p2wpkh | 1 | 13-k1-update-p2wpkh |
| `bcrt1pyy5qr7flzy6dfahe9thvzn8v3gnzgys009rgjslnyqhdk893c9tsrf4jwx` | p2tr | 1 | 14-k1-update-p2tr |
| `bcrt1qlhzggmwv9p3d9kvvsrx9h2fy074x6s9jylx88w` | p2wpkh | 1 | 15-x1-beacon-rotation |
| `mhFLJc171wwatThXQPrCh6CQ1PRMBDiVkD` | p2pkh | 1 | 15-x1-beacon-rotation |
| `bcrt1q5xnqt68zza8dza2slk7f7jccdlfyeweeytfmxj` | p2wpkh | 1 | 16-x1-beacon-add-then-use |
| `bcrt1q08t5t37a8jprkdxfuc92vypldsj67hl9eewpkl` | p2wpkh | 1 | 16-x1-beacon-add-then-use |
| `bcrt1qfj6gmvrd7w23a0sdcxp7z6fa9947v32v6s3ee0` | p2wpkh | 2 | 17-x1-vm-add-rotate-authentication |
| `bcrt1qskje5rvnf9tuq9yv03xauk83hp7lapv48ljnga` | p2wpkh | 1 | 18-x1-embedded-invocation-key |
| `bcrt1qxw0zrh25d0jfjqckspen0sdwsyncm40uh0caye` | p2wpkh | 1 | 19-x1-relative-ids |
| `bcrt1q4wcscm9u3x0pnd0j5vjc0c06rccstm3ms7h3t4` | p2wpkh | 1 | 20-k1-cas-update |
| `bcrt1q2zca9vwejd7kt7swalmpzf266fzmkpjwx2xfhp` | p2wpkh | 2 | 21-k1-deactivate-then-update |
| `bcrt1qa5z4q7nj6t8ld2s9sj3q85vn0y0yzcgq5mawre` | p2wpkh | 3 | 22-x1-three-updates-resolution-options |
| `bcrt1qh8zerm0405c8takq6k7y2p6yfde85fgnxjqm03` | p2wpkh | 3 | 23-k1-duplicate-signal |
| `bcrt1q3trc9ahl5a9ca88734frumcvzsq8z0m7ut5ru8` | p2wpkh | 1 | 24-k1-removed-beacon-signal |
| `mtAkYqLtxbZzM4ZUDTt6qB8DTJjEnvSfLU` | p2pkh | 1 | 24-k1-removed-beacon-signal |
| `bcrt1qse9m59ayatulpaxrv02xltw7skdpj0dpu40u23` | p2wpkh | 1 | 26-k1-signal-below-current-height |
| `bcrt1qp7m4l8kf0hqmexefca2vmc4ytly53luvtkpen6` | p2wpkh | 1 | 26-k1-signal-below-current-height |
| `bcrt1qger6zvhnetkg2y25rl0ctnq797p7zqgryf288q` | p2wpkh | 1 | n05-x1-missing-update-data |
| `bcrt1q075legkpsqpa9mskt3wk6a4ylzt6unnnfrru2h` | p2wpkh | 1 | n10-k1-invalid-update-context-member |
| `bcrt1qv5qmthk9nw7s0waxp56m7cq5ntuspecc4zwmh8` | p2wpkh | 1 | n11-k1-invalid-update-context-order |
| `bcrt1q3sa6rrrt0wyfnnyj9pnau5h9nsulj2j2c6vres` | p2wpkh | 1 | n12-k1-invalid-update-proof-context |
| `bcrt1qqy22p8tjxdysqgh7wc8ly3gacd324s5v8lvjwv` | p2wpkh | 1 | n13-k1-invalid-update-capability-action |
| `bcrt1q4z8lgj2hv99azjat3zvv2vyqupt7mt9k92a0tm` | p2wpkh | 1 | n14-k1-invalid-update-capability-encoding |
| `bcrt1q254er2rznuas3aw8szfl22q6r52gu9v3c6ulra` | p2wpkh | 1 | n15-k1-invalid-update-proof-purpose |
| `bcrt1qkx7g63upvsncejwv0cajfktmd78tse7w6s5lyr` | p2wpkh | 1 | n16-x1-invalid-update-unauthorized-method |
| `bcrt1qev4g9ud9qpp9r0m8g9qk4zzccht4cyc0max0lp` | p2wpkh | 1 | n17-k1-invalid-update-unknown-method |
| `bcrt1qyyz9ffdy8y7yj6ywlw4u2c6dyaksmadf5mud4n` | p2wpkh | 1 | n18-k1-invalid-update-proof-value |
| `bcrt1qph7mrarkt3v5rw8fvgvdelncc9g30c9a9u0c8x` | p2wpkh | 1 | n19-k1-invalid-update-source-hash |
| `bcrt1qcdqfr3h8tnmdry006dd70fzt6hpnpwdxuk6q7c` | p2wpkh | 1 | n20-k1-invalid-update-target-hash |
| `bcrt1qnsp2668lre5sdmczeyhv7jddwyvgf45e8a0t3n` | p2wpkh | 1 | n21-k1-invalid-update-version-skip |
| `bcrt1qfv3ynyzmm7tsc7elsxlmkyjmmcxakfxulp2xrm` | p2wpkh | 1 | n22-k1-invalid-update-patch-missing-path |
| `bcrt1qtvrdsxcpfqfdwtvpm8fzfw6tu76fe9rdm05y4z` | p2wpkh | 1 | n23-k1-invalid-update-patch-changes-id |
| `bcrt1quyvfk3j8958qu3j2rwjm2lgqjdw63rdxtxmh4p` | p2wpkh | 1 | n24-k1-invalid-update-patch-invalid-document |
| `bcrt1qh7djrvf4j06y3gn7aeahjpu4h8tacajmc6d9kx` | p2wpkh | 1 | n25-k1-invalid-update-created-after-block |
| `bcrt1qn9spqspcv0sqreuergj0je7tpjw7u70fgveyjf` | p2wpkh | 1 | n26-k1-invalid-update-expires-before-mediantime |
| `bcrt1qu35h39uw64ga95rsqpp30ml8m5dffaxp0qy7ml` | p2wpkh | 1 | n27-k1-invalid-update-expires-before-created |
| `bcrt1ql8pf36yg9hue9azjfl0v9ray9yrhamnsf05mlj` | p2wpkh | 1 | n28-k1-late-publishing |
| `n4HZfgE3Yf3kRkm2hQjQ76xJ769EvUCBDC` | p2pkh | 1 | n28-k1-late-publishing |

## Cohort beacon addresses

One shared address per cohort, funded once, one OP_RETURN for every member.

| Cohort | Type | Members |
|--------|------|---------|
| cas-09 | CASBeacon | 09a-x1-cas-update-announcement, 09b-x1-cas-update-announcement-paired |
| cas-10 | CASBeacon | 10a-x1-sidecar-update-cas-announcement, 10b-x1-sidecar-update-cas-announcement-paired |
| smt-11 | SMTBeacon | 11a-x1-cas-update-smt-proof, 11b-x1-cas-update-smt-proof-paired |
| smt-12 | SMTBeacon | 12a-x1-sidecar-update-smt-proof, 12b-x1-sidecar-update-smt-proof-paired |
| smt-25 | SMTBeacon | 25a-x1-smt-update-no-nonce, 25b-x1-smt-nonce-no-update, 25c-x1-smt-empty-index, n29-x1-smt-proof-hash, n30-x1-smt-proof-root-id, n31-x1-smt-proof-withheld |

### Plain list (43 solo addresses, one per line)

```
n4PmTdLkRhxnreFzW2cKE3hYrWmmratT2P
mmS49Jsg6Yf4Arc16Eie2wWJei61x7Gey5
bcrt1quhdgr52jrtnx7g9t5c4y9zyrz0rvjppdkakl00
n3fnKAdm8pTGb9oGyeLAdSnJSMu6dvTPy8
bcrt1qfvtnzgdj5jg86eea278kc8ggzwnw7qaysru4jz
bcrt1q6vz70rnr2d4c3msw2h54vpwelc5hxdh0f4ny2k
bcrt1pyy5qr7flzy6dfahe9thvzn8v3gnzgys009rgjslnyqhdk893c9tsrf4jwx
bcrt1qlhzggmwv9p3d9kvvsrx9h2fy074x6s9jylx88w
mhFLJc171wwatThXQPrCh6CQ1PRMBDiVkD
bcrt1q5xnqt68zza8dza2slk7f7jccdlfyeweeytfmxj
bcrt1q08t5t37a8jprkdxfuc92vypldsj67hl9eewpkl
bcrt1qfj6gmvrd7w23a0sdcxp7z6fa9947v32v6s3ee0
bcrt1qskje5rvnf9tuq9yv03xauk83hp7lapv48ljnga
bcrt1qxw0zrh25d0jfjqckspen0sdwsyncm40uh0caye
bcrt1q4wcscm9u3x0pnd0j5vjc0c06rccstm3ms7h3t4
bcrt1q2zca9vwejd7kt7swalmpzf266fzmkpjwx2xfhp
bcrt1qa5z4q7nj6t8ld2s9sj3q85vn0y0yzcgq5mawre
bcrt1qh8zerm0405c8takq6k7y2p6yfde85fgnxjqm03
bcrt1q3trc9ahl5a9ca88734frumcvzsq8z0m7ut5ru8
mtAkYqLtxbZzM4ZUDTt6qB8DTJjEnvSfLU
bcrt1qse9m59ayatulpaxrv02xltw7skdpj0dpu40u23
bcrt1qp7m4l8kf0hqmexefca2vmc4ytly53luvtkpen6
bcrt1qger6zvhnetkg2y25rl0ctnq797p7zqgryf288q
bcrt1q075legkpsqpa9mskt3wk6a4ylzt6unnnfrru2h
bcrt1qv5qmthk9nw7s0waxp56m7cq5ntuspecc4zwmh8
bcrt1q3sa6rrrt0wyfnnyj9pnau5h9nsulj2j2c6vres
bcrt1qqy22p8tjxdysqgh7wc8ly3gacd324s5v8lvjwv
bcrt1q4z8lgj2hv99azjat3zvv2vyqupt7mt9k92a0tm
bcrt1q254er2rznuas3aw8szfl22q6r52gu9v3c6ulra
bcrt1qkx7g63upvsncejwv0cajfktmd78tse7w6s5lyr
bcrt1qev4g9ud9qpp9r0m8g9qk4zzccht4cyc0max0lp
bcrt1qyyz9ffdy8y7yj6ywlw4u2c6dyaksmadf5mud4n
bcrt1qph7mrarkt3v5rw8fvgvdelncc9g30c9a9u0c8x
bcrt1qcdqfr3h8tnmdry006dd70fzt6hpnpwdxuk6q7c
bcrt1qnsp2668lre5sdmczeyhv7jddwyvgf45e8a0t3n
bcrt1qfv3ynyzmm7tsc7elsxlmkyjmmcxakfxulp2xrm
bcrt1qtvrdsxcpfqfdwtvpm8fzfw6tu76fe9rdm05y4z
bcrt1quyvfk3j8958qu3j2rwjm2lgqjdw63rdxtxmh4p
bcrt1qh7djrvf4j06y3gn7aeahjpu4h8tacajmc6d9kx
bcrt1qn9spqspcv0sqreuergj0je7tpjw7u70fgveyjf
bcrt1qu35h39uw64ga95rsqpp30ml8m5dffaxp0qy7ml
bcrt1ql8pf36yg9hue9azjfl0v9ray9yrhamnsf05mlj
n4HZfgE3Yf3kRkm2hQjQ76xJ769EvUCBDC
```

## All beacon addresses per scenario

### 01-k1-base

- **DID:** `did:btcr2:k1qgp45a3ycrpc54uqmq0z9zt2qnhtvlwxnhrv0phdkkzq9teq5j35y4stunrnq`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `n2UZsP5zPj4uDZ8Q6Uy97f9H6g4SLsjXhb`
  - `initialP2WPKH` (SingletonBeacon): `bcrt1quhn3d7hxz5u9fs0wd2rc77zfws605s8drkx2c6`
  - `initialP2TR` (SingletonBeacon): `bcrt1p0al08lcrz8mnd5wh8wqgln76wk5y6ckuncttfq0anjwdph6dyynsh0g50c`

### 02-k1-sidecar-update

- **DID:** `did:btcr2:k1qgph7nrekhzerkmsktp8l7rdtpxh2mw45xp6e90sjvxszpz6au0grssegjx6z`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `n4PmTdLkRhxnreFzW2cKE3hYrWmmratT2P`
  - `initialP2WPKH` (SingletonBeacon): `bcrt1qlthwln3nk4u8g0efrskuu6p7gy97dncegeqwy6`
  - `initialP2TR` (SingletonBeacon): `bcrt1p4pwghp2swy74482guykr506q67rtn37vep0692pdrc6zn866ekqqmllg2r`
- Anchors:
  - update 1 at `initialP2PKH` (p2pkh, key genesis): `n4PmTdLkRhxnreFzW2cKE3hYrWmmratT2P`

### 03-x1-base

- **DID:** `did:btcr2:x1qf5zrqc4fem7l65n0lpckw7yrdjelv4699lyvu8rn92q2rkws8ge7k7qm4n`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mzUD4uFqotkRa69SzVbcAyHdVpQEY5ppMD`
  - `initialP2WPKH` (SingletonBeacon): `bcrt1qeljhjhvwdx2h84d5qy5cg87wkfxyz6un9pma6g`
  - `initialP2TR` (SingletonBeacon): `bcrt1pcqty8yv5p4mjkr2zn2qryunr2xet2t0rxt85xducz4j75hw4xrmqp3j5z5`

### 04-x1-sidecar-update

- **DID:** `did:btcr2:x1q2z78yxz3gy7pu25awwxlf4vgffrzkcatt909seqsucuw9ar47rr5jdfy8k`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mmS49Jsg6Yf4Arc16Eie2wWJei61x7Gey5`
  - `initialP2WPKH` (SingletonBeacon): `bcrt1qgr3ca0vfd6pfhpxtjxwhtkhm8unu5rmzqjl7vt`
  - `initialP2TR` (SingletonBeacon): `bcrt1pvzh69rcte9tw0he9ynaaku944swzssc3mrt7x7347q46lytesk7qpp3whc`
- Anchors:
  - update 1 at `initialP2PKH` (p2pkh, key genesis): `mmS49Jsg6Yf4Arc16Eie2wWJei61x7Gey5`

### 05-x1-no-beacon

- **DID:** `did:btcr2:x1qghp0w22wfyfkuekq75ddh5yrgu4fm20xc40np9djzptpafskklpgl4jf7j`
- _(no beacon services in this DID document)_

### 06-x1-cas-3-updates

- **DID:** `did:btcr2:x1qfgeftzejym8u9wype970senp4l82tktag2gal5d3v8kvpnf2k08jwrnudj`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `n2UJo84vRpP57hoo6B9FYDjC86gCRHcG3u`
  - `initialP2WPKH` (SingletonBeacon): `bcrt1quhdgr52jrtnx7g9t5c4y9zyrz0rvjppdkakl00`
  - `initialP2TR` (SingletonBeacon): `bcrt1pa8lffxa2jw9aecxux5vtc2kzd5c2a9nrxelnl88q97wkarux2f4qdvnny8`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `bcrt1quhdgr52jrtnx7g9t5c4y9zyrz0rvjppdkakl00`
  - update 2 at `initialP2WPKH` (p2wpkh, key genesis): `bcrt1quhdgr52jrtnx7g9t5c4y9zyrz0rvjppdkakl00`
  - update 3 at `initialP2WPKH` (p2wpkh, key genesis): `bcrt1quhdgr52jrtnx7g9t5c4y9zyrz0rvjppdkakl00`

### 07-k1-sidecar-deactivate

- **DID:** `did:btcr2:k1qgpx06u2yw3404yajkf4xv339xu3zc078lj55q3ew2p3kvr3823yn3swgvhfu`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `n3fnKAdm8pTGb9oGyeLAdSnJSMu6dvTPy8`
  - `initialP2WPKH` (SingletonBeacon): `bcrt1q7tlzm6gyv4gdj73crexertvtvy2rt4weefzyd0`
  - `initialP2TR` (SingletonBeacon): `bcrt1pvntpj0rvsak5yaa8zhhaat8tfxqfq9hm4mt4zsg2zz666sn9vdtsn7rg65`
- Anchors:
  - update 1 at `initialP2PKH` (p2pkh, key genesis): `n3fnKAdm8pTGb9oGyeLAdSnJSMu6dvTPy8`

### 08-x1-cas-update-deactivate

- **DID:** `did:btcr2:x1qtg5vcwkxhusl65yh2h5wls67scs57czrrv9dzgpu2zh0525plyhjnuqr73`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mnMzkqv69n9NFWEuJJtAQECx2RspRN3nMP`
  - `initialP2WPKH` (SingletonBeacon): `bcrt1qfvtnzgdj5jg86eea278kc8ggzwnw7qaysru4jz`
  - `initialP2TR` (SingletonBeacon): `bcrt1pwdwqrlsd2aa5v0w4c0dqedc0mdwu4kkydxel88642uu62l978sxsvk5t54`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `bcrt1qfvtnzgdj5jg86eea278kc8ggzwnw7qaysru4jz`
  - update 2 at `initialP2WPKH` (p2wpkh, key genesis): `bcrt1qfvtnzgdj5jg86eea278kc8ggzwnw7qaysru4jz`

### 09a-x1-cas-update-announcement

- **DID:** `did:btcr2:x1qg5kgjm0ms2e8uq949lytmjgpe7l7leuqmjq6szq99kgl5yj5wlxxxjsajl`
- **Cohort:** cas-09
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mxJrXYBWXMGRub1HqU6VsqjxxVDDr5564J`
  - `initialP2WPKH` (SingletonBeacon): `bcrt1qhqc92ysudyw0e4shlucfvjl57w9ccmaqk32lp7`
  - `initialP2TR` (SingletonBeacon): `bcrt1p0hnjju4yj9e8h4k3248qhqvm9vr7kf05wyveqad64j6krkkr6w2qhkgvvw`
  - `cohortBeacon` (CASBeacon): `bcrt1qjme07kcxxv38ddemw83fef20ehlrmr7rtj6jnt`

### 09b-x1-cas-update-announcement-paired

- **DID:** `did:btcr2:x1qfmlfxutk2u5qpa8gl5x63r2zf8a4gh4wyevu4gurcksgksgce9f5ywm75v`
- **Cohort:** cas-09
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `n1wE48Un46HhxPZ2o7ChBej7mBCVi7dG9y`
  - `initialP2WPKH` (SingletonBeacon): `bcrt1qmlu60rpdj9ya2yjnev3ynmjqv7j4rq4c00v4pc`
  - `initialP2TR` (SingletonBeacon): `bcrt1p48m3wxum72wjvxuf79sdmnnaq8h56hu68wt052alftfazlhwudfsd94lqk`
  - `cohortBeacon` (CASBeacon): `bcrt1qjme07kcxxv38ddemw83fef20ehlrmr7rtj6jnt`

### 10a-x1-sidecar-update-cas-announcement

- **DID:** `did:btcr2:x1qgxluz9hrdy9l46a87pw4nfgp9l5658lp5k3hvgrtnc2y6j67gfaxv6ev4d`
- **Cohort:** cas-10
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mtUWuLEgcr3nPMBTXNeQnhZEXqfNr5q5vj`
  - `initialP2WPKH` (SingletonBeacon): `bcrt1q3c3ekalha8w9pc0z4e390kjp065ajfhrfft502`
  - `initialP2TR` (SingletonBeacon): `bcrt1pcpzklt8v0tm6ajyp083f3khq8rqcfsky8pzn95pg3sdfvhsgtarqctum0g`
  - `cohortBeacon` (CASBeacon): `bcrt1qnazmwtruwr7h4ag2yea3spa2nc3aal23vyw3pl`

### 10b-x1-sidecar-update-cas-announcement-paired

- **DID:** `did:btcr2:x1qtxu0aj9a8y5ru2as7zulqcchlxj7ay8su57k9wwxakqj4pmcchk5ftpw24`
- **Cohort:** cas-10
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mtNaqhL15VYZ2Wks88Uk4KvXBPJ2t2KrnR`
  - `initialP2WPKH` (SingletonBeacon): `bcrt1q35zxtusda42qct8fmt8x5wnq5gq8gee0aqqfsh`
  - `initialP2TR` (SingletonBeacon): `bcrt1p0cj8k4pchlnqwpauz9yq8r2fg4k3zgsmfzzyzt0s8w8ngf73t9psqsd992`
  - `cohortBeacon` (CASBeacon): `bcrt1qnazmwtruwr7h4ag2yea3spa2nc3aal23vyw3pl`

### 11a-x1-cas-update-smt-proof

- **DID:** `did:btcr2:x1qfgm2swrsxeal7rjs8tm4dgsqatq5qt46c5cyd68c0fg695n2zv3kjavh2c`
- **Cohort:** smt-11
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `n3WVcVSUwH2JFeCbNz6E7FULpAmd2ZPGvc`
  - `initialP2WPKH` (SingletonBeacon): `bcrt1q7y78ulmnlssljcj2puncy069p9tvqu0ajxpmad`
  - `initialP2TR` (SingletonBeacon): `bcrt1pd2wqn5myy47xvktrp3s5nkt87t909rdemtmz39gm46njar8rhl4sdkmafk`
  - `cohortBeacon` (SMTBeacon): `bcrt1qr5l70wffrssf9jtmcrhuyccledl5mlr3zyw824`

### 11b-x1-cas-update-smt-proof-paired

- **DID:** `did:btcr2:x1qfzppzx5pq3hs2d5t4texy3p47kgv8mlcvadvx7lshu3ug47h4fcuj6l6tv`
- **Cohort:** smt-11
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `msALr6iQkNFQRnSGCEqaTkfHQqaupHdrsY`
  - `initialP2WPKH` (SingletonBeacon): `bcrt1q07aen8undtzejejcsldpuexkvpjrrl27x87mkm`
  - `initialP2TR` (SingletonBeacon): `bcrt1pcakca9vu6h0j8r8ulhmls2ukgp2nea08tzxlsqq63cc9xggslcwqez9l6n`
  - `cohortBeacon` (SMTBeacon): `bcrt1qr5l70wffrssf9jtmcrhuyccledl5mlr3zyw824`

### 12a-x1-sidecar-update-smt-proof

- **DID:** `did:btcr2:x1qfwwah7zf75x9lw4kugpfkukzpagpgfn4pz5pxp9yurvx88yp0wfk3d8qy8`
- **Cohort:** smt-12
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mgLkZTDKXXGMpPJiSd2gV4rEbP8opiog9f`
  - `initialP2WPKH` (SingletonBeacon): `bcrt1qpy9zhv4x5hcwzg0vjdc20a9rpdgkt8dklmrda3`
  - `initialP2TR` (SingletonBeacon): `bcrt1ptsam6ph2hv3cxe3nkupzm57r8t7m8yav4hdxrz78dm3cgs29zahq3tnznq`
  - `cohortBeacon` (SMTBeacon): `bcrt1qfw95sv44pyh404rkjsnzp8txvav5eytacekcad`

### 12b-x1-sidecar-update-smt-proof-paired

- **DID:** `did:btcr2:x1qf9ruh87defxl2au4ct0ru72zrhxj8mffwf2tzachtu56jmsz2mqvesqvzl`
- **Cohort:** smt-12
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `n2ZnXuYBSwE4eBZKEm47TkRBmFZ6ea5NXn`
  - `initialP2WPKH` (SingletonBeacon): `bcrt1qum3mmwe2020up380k3r446w0zccsqjnyk9srax`
  - `initialP2TR` (SingletonBeacon): `bcrt1pndck23cpdt87lh3cqgc9nfke364wzskdtcdhw5tyndf0d0m3khrsaf2w28`
  - `cohortBeacon` (SMTBeacon): `bcrt1qfw95sv44pyh404rkjsnzp8txvav5eytacekcad`

### 13-k1-update-p2wpkh

- **DID:** `did:btcr2:k1qgpseq0vxhuqzu8cj4j8f5q35jg7s5epym0z07fh3pltkgxma6c26hcwp2a9j`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mzkjwnP3j8CmF85T1sigxiE5brbW7dadCJ`
  - `initialP2WPKH` (SingletonBeacon): `bcrt1q6vz70rnr2d4c3msw2h54vpwelc5hxdh0f4ny2k`
  - `initialP2TR` (SingletonBeacon): `bcrt1p6lt77utpqvlrxqpdvlqz3xnrgcx9tc8wpx2p5gpsrcvjfpwc9rrq6d3xpa`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `bcrt1q6vz70rnr2d4c3msw2h54vpwelc5hxdh0f4ny2k`

### 14-k1-update-p2tr

- **DID:** `did:btcr2:k1qgpw4847amlkkkyys6jynhummypj6u9w2f2ew3lw3eqej2df5fj6nkgq097j6`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mv38457M1rZvG5F4PnbaLwTRMZ3RU6Y7e4`
  - `initialP2WPKH` (SingletonBeacon): `bcrt1qnarx9k75l2hpp2dzvp2c6xuc65vl5zyvrg4evr`
  - `initialP2TR` (SingletonBeacon): `bcrt1pyy5qr7flzy6dfahe9thvzn8v3gnzgys009rgjslnyqhdk893c9tsrf4jwx`
- Anchors:
  - update 1 at `initialP2TR` (p2tr, key genesis): `bcrt1pyy5qr7flzy6dfahe9thvzn8v3gnzgys009rgjslnyqhdk893c9tsrf4jwx`

### 15-x1-beacon-rotation

- **DID:** `did:btcr2:x1qfaqdrxu007dltfgc4g6cdf344n7u35djtzn4tmvn0uqmap8g9gh5rr0vrz`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `n4ekfrAgcWeEgzFqDvuFJ2T52Dvd5j9SQQ`
  - `initialP2WPKH` (SingletonBeacon): `bcrt1qlhzggmwv9p3d9kvvsrx9h2fy074x6s9jylx88w`
  - `initialP2TR` (SingletonBeacon): `bcrt1pp9y9pk0s27qkrnx8gm0yhqtsyvdssmg83lrmtf5v0sxgjaz75d8sddvvl7`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `bcrt1qlhzggmwv9p3d9kvvsrx9h2fy074x6s9jylx88w`
  - update 2 at `initialP2PKH` (p2pkh, key rotated): `mhFLJc171wwatThXQPrCh6CQ1PRMBDiVkD`

### 16-x1-beacon-add-then-use

- **DID:** `did:btcr2:x1qt04c7dnwmvz9nd72w0w3cdtyahglxrfq62rnrfs4n59dq2gf0scqfad42g`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mvFfyRbYbhw2azEqavPXAiVFjSYeJmz6Ae`
  - `initialP2WPKH` (SingletonBeacon): `bcrt1q5xnqt68zza8dza2slk7f7jccdlfyeweeytfmxj`
  - `initialP2TR` (SingletonBeacon): `bcrt1p4rfee08saucpp0jvecmjukv3zeyl6nyqwv9n866at5uaxe3np4fsh9umlw`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `bcrt1q5xnqt68zza8dza2slk7f7jccdlfyeweeytfmxj`
  - update 2 at `newBeacon` (p2wpkh, key newBeacon): `bcrt1q08t5t37a8jprkdxfuc92vypldsj67hl9eewpkl`

### 17-x1-vm-add-rotate-authentication

- **DID:** `did:btcr2:x1qg935lwg9dl37eg227u8dzrqe4sng797ycrjtdu6kt9nqcq2hjzd5wdhgz6`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mnWXwi3HJ63EKQxUxZZw22EEaxEztaELP5`
  - `initialP2WPKH` (SingletonBeacon): `bcrt1qfj6gmvrd7w23a0sdcxp7z6fa9947v32v6s3ee0`
  - `initialP2TR` (SingletonBeacon): `bcrt1pyqke9v8spnr2z8st99dkaywe9ptxkt8m2suw0ny6hz9vxvjffvqsfger92`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `bcrt1qfj6gmvrd7w23a0sdcxp7z6fa9947v32v6s3ee0`
  - update 2 at `initialP2WPKH` (p2wpkh, key genesis): `bcrt1qfj6gmvrd7w23a0sdcxp7z6fa9947v32v6s3ee0`

### 18-x1-embedded-invocation-key

- **DID:** `did:btcr2:x1qtrhj3w0m8y4ztp5077swct0hg6jfs0dp67wpn9ekwf0tq5yfxpwjn9leez`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mshcYnCeANyU49tVfd9qbYCWsa9ZJS1Cri`
  - `initialP2WPKH` (SingletonBeacon): `bcrt1qskje5rvnf9tuq9yv03xauk83hp7lapv48ljnga`
  - `initialP2TR` (SingletonBeacon): `bcrt1ph5qyaswgys94rnm2dcxmryhsmdnyq6vrkf0a7d9dk0jjcezznclqgvvn78`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `bcrt1qskje5rvnf9tuq9yv03xauk83hp7lapv48ljnga`

### 19-x1-relative-ids

- **DID:** `did:btcr2:x1qtk24dpv4afp9kv7s4lw044x3pytxexq8rjxwtazud0g9z0ghz43cepamkp`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mkDtC4VchbbtAjCwsiuyouggPA6xPoSHZr`
  - `initialP2WPKH` (SingletonBeacon): `bcrt1qxw0zrh25d0jfjqckspen0sdwsyncm40uh0caye`
  - `initialP2TR` (SingletonBeacon): `bcrt1p0yrfpz0fpc2hd8c42deg9e8rw4gvhpg4fkkzvsfkv08hs5jx4zeqdfleyh`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `bcrt1qxw0zrh25d0jfjqckspen0sdwsyncm40uh0caye`

### 20-k1-cas-update

- **DID:** `did:btcr2:k1qgphrh53zup2a5p3ecnfk365hacre49rxej9ezepgdcv05sdhupdlgqyx9pne`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mwAmwQS8YxrfUYFhKcbuj5Am3vkSnXt2o5`
  - `initialP2WPKH` (SingletonBeacon): `bcrt1q4wcscm9u3x0pnd0j5vjc0c06rccstm3ms7h3t4`
  - `initialP2TR` (SingletonBeacon): `bcrt1p93fl4fdfdc069cvgm6h03u2a7e9nz06dmah7zulmvd9q5j8w6vdqhwar76`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `bcrt1q4wcscm9u3x0pnd0j5vjc0c06rccstm3ms7h3t4`

### 21-k1-deactivate-then-update

- **DID:** `did:btcr2:k1qgpgm6kn4wqgd3unxtsht9rh34pdqc74tczdlwttp3kc7w9jsekc6lgfrhjdr`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mnsdNm616P4T7niycbSs3C9EUrZ9hQWxNZ`
  - `initialP2WPKH` (SingletonBeacon): `bcrt1q2zca9vwejd7kt7swalmpzf266fzmkpjwx2xfhp`
  - `initialP2TR` (SingletonBeacon): `bcrt1p3dxgev6e588s5fgstcqw3xlqwntnz458h5qaxjwje0x3j3uucm5suhkmv5`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `bcrt1q2zca9vwejd7kt7swalmpzf266fzmkpjwx2xfhp`
  - update 2 at `initialP2WPKH` (p2wpkh, key genesis): `bcrt1q2zca9vwejd7kt7swalmpzf266fzmkpjwx2xfhp`

### 22-x1-three-updates-resolution-options

- **DID:** `did:btcr2:x1qg4zny9hzqfyvxtp6wr33k9n33kwkxujrs3n9z6k3mlq7ah93wwtqp3v2et`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `n38ComRAhQbwYWrj2x5ijddBkhLKEojo1D`
  - `initialP2WPKH` (SingletonBeacon): `bcrt1qa5z4q7nj6t8ld2s9sj3q85vn0y0yzcgq5mawre`
  - `initialP2TR` (SingletonBeacon): `bcrt1pepddlaqd9hqsk9tfsuwcvxnlssmem4wyzlvsy3vp52tesfv5huusmtzkux`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `bcrt1qa5z4q7nj6t8ld2s9sj3q85vn0y0yzcgq5mawre`
  - update 2 at `initialP2WPKH` (p2wpkh, key genesis): `bcrt1qa5z4q7nj6t8ld2s9sj3q85vn0y0yzcgq5mawre`
  - update 3 at `initialP2WPKH` (p2wpkh, key genesis): `bcrt1qa5z4q7nj6t8ld2s9sj3q85vn0y0yzcgq5mawre`

### 23-k1-duplicate-signal

- **DID:** `did:btcr2:k1qgp0enf0aafye8cnr7nm0x0r8sweyyj08cn0werj6ncs6ygsd2s4clsc59mmt`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mxTDyx2LwYyLBA3mQ1NF2ZMkEuSiYMw25g`
  - `initialP2WPKH` (SingletonBeacon): `bcrt1qh8zerm0405c8takq6k7y2p6yfde85fgnxjqm03`
  - `initialP2TR` (SingletonBeacon): `bcrt1p4ue3qucgv9ler3z8hmzc5nvqenedsvzcaf9s8ec2hhuzaug0ppaserjsnc`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `bcrt1qh8zerm0405c8takq6k7y2p6yfde85fgnxjqm03`
  - update 2 at `initialP2WPKH` (p2wpkh, key genesis): `bcrt1qh8zerm0405c8takq6k7y2p6yfde85fgnxjqm03`
  - update 3 at `initialP2WPKH` (p2wpkh, key genesis): `bcrt1qh8zerm0405c8takq6k7y2p6yfde85fgnxjqm03`

### 24-k1-removed-beacon-signal

- **DID:** `did:btcr2:k1qgpz0cp4jlpknkqyc7j30ht27cq272t6vww0xg5mqj9sxrpxjx5kf9s2mwvps`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mtAkYqLtxbZzM4ZUDTt6qB8DTJjEnvSfLU`
  - `initialP2WPKH` (SingletonBeacon): `bcrt1q3trc9ahl5a9ca88734frumcvzsq8z0m7ut5ru8`
  - `initialP2TR` (SingletonBeacon): `bcrt1p0ks0fvcjx7cvykyftlq6hzjsfjawpyc0upv4m5rltfj6wv7lmlesdf8egl`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `bcrt1q3trc9ahl5a9ca88734frumcvzsq8z0m7ut5ru8`
  - update 2 at `initialP2PKH` (p2pkh, key genesis): `mtAkYqLtxbZzM4ZUDTt6qB8DTJjEnvSfLU`

### 25a-x1-smt-update-no-nonce

- **DID:** `did:btcr2:x1qfqxmcf0tnarx4j59s3sfzxs82qrsgnr4vgutpymyhl4s7t9qj6z59jz09t`
- **Cohort:** smt-25
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `msvyRbXtFUhursjYRdbtodHE2sBTebJTBW`
  - `initialP2WPKH` (SingletonBeacon): `bcrt1q3qkxlyzk6e57ap5js04fcuvg8hsff3tvmlv9mx`
  - `initialP2TR` (SingletonBeacon): `bcrt1pl3h3qwxq2rdzvv28gcut6t90kh3e86wkm3emtsunn0daqtejmy2sj7zrud`
  - `cohortBeacon` (SMTBeacon): `bcrt1q9cck2y2qyunlevrq264ezxumfwp5dptjhctrhc`

### 25b-x1-smt-nonce-no-update

- **DID:** `did:btcr2:x1qtcszm9j8az6ku8pnzp66qk86hune0za5p420e5fl9y7xdm50zq05s4jk76`
- **Cohort:** smt-25
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mtp3zSXJ5DPfPQWiZhHQTHvzUqY2yDkCn9`
  - `initialP2WPKH` (SingletonBeacon): `bcrt1qj82hv2hyrmv9czcrd303d48xqw6qd44nzt4efv`
  - `initialP2TR` (SingletonBeacon): `bcrt1pcevhk95m8zgqkxtmxzffk0ccpasg2h8vqccsq0sdnmgmaajdtfasfpyz3s`
  - `cohortBeacon` (SMTBeacon): `bcrt1q9cck2y2qyunlevrq264ezxumfwp5dptjhctrhc`

### 25c-x1-smt-empty-index

- **DID:** `did:btcr2:x1q2tyuy6ttnjj5pmdktrgclld3cep0p0xf92t0wat563js7lcaalgc5rjnew`
- **Cohort:** smt-25
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mq6k2NdAMWy4Kwp3gzCdg9ECo6j7XdE1LQ`
  - `initialP2WPKH` (SingletonBeacon): `bcrt1qdywsstlv9g8qgdgpw9y4texv6stzmakzf5mu7h`
  - `initialP2TR` (SingletonBeacon): `bcrt1p0hn34zqax678casnzlensmctpx46yu88a6srjvng8hgwsjmg85rsncmc62`
  - `cohortBeacon` (SMTBeacon): `bcrt1q9cck2y2qyunlevrq264ezxumfwp5dptjhctrhc`

### 26-k1-signal-below-current-height

- **DID:** `did:btcr2:k1qgpqx3263emcj93twykjstes7mzkgxrrryu57yz4awkha53prde8utg4kff5m`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `msm3ZMj8iQmkrVcxULiymk4s8A81MVc7pC`
  - `initialP2WPKH` (SingletonBeacon): `bcrt1qse9m59ayatulpaxrv02xltw7skdpj0dpu40u23`
  - `initialP2TR` (SingletonBeacon): `bcrt1p6twy0j8rtap6279sdz8j27v28mzuc2llgx73pgx6grr2v5awaaaqeuantm`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `bcrt1qse9m59ayatulpaxrv02xltw7skdpj0dpu40u23`
  - update 2 at `lateBeacon` (p2wpkh, key lateBeacon): `bcrt1qp7m4l8kf0hqmexefca2vmc4ytly53luvtkpen6`

### n01-k1-invalid-did-checksum

- **DID:** `did:btcr2:k1qgp0hy8cwcgrj7cw8ufawj8gmmfqsaew83sh8f40wfzntspety3ep9cz42djs`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `miVH81iXrWYgTNP6vPxDrGyjNUeA6FY4LP`
  - `initialP2WPKH` (SingletonBeacon): `bcrt1qyzt59ed0q3n98qa50hrjgtzv2cdgjfqeqznulv`
  - `initialP2TR` (SingletonBeacon): `bcrt1pf9kc0tle6a9m7tjzhfpcdgcer9z8fntjrn20hdn3krcxh4s5ncwqhkykv7`

### n02-x1-invalid-did-padding

- **DID:** `did:btcr2:x1qfrgktt67zycyup5hcxnhy4hayjyjszg39zkenhunsxc6mtlkc7ckumfpar`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `n4dqurbQ6k6FjNsN4ewhcZr2aFRh1NYuMx`
  - `initialP2WPKH` (SingletonBeacon): `bcrt1qlkv85zk0x6nat3qqmnecmt0ttl6jdk4mll4qyy`
  - `initialP2TR` (SingletonBeacon): `bcrt1pdzjhg098549nta2tnpzndsawn0e7v9fhg5p9gzhfrju8vwerlqjs855kh7`

### n03-k1-invalid-did-network-nibble

- **DID:** `did:btcr2:k1qgp0cg8668q6wwdgtxh3lceakmc0l43wrjzc2pa8suhej0ywpspf3gqjhnx8t`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mgviyuJqSkzBjqUwyGLPbkPX8ksZNzRnJ1`
  - `initialP2WPKH` (SingletonBeacon): `bcrt1qpam0a6ht5zf47ayrs0y2djrpqcn8pf8a2rvqz2`
  - `initialP2TR` (SingletonBeacon): `bcrt1pht8czt56j55245xpp69wpsrghzzdw2csate7h2nfqfwdkmvm0e5qmcrtks`

### n04-x1-genesis-hash-mismatch

- **DID:** `did:btcr2:x1qgaglc0dpu0mhktpgzfcna9qxemcr99yrhq72hex4kx4jhcumxj5cc4yygv`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mjnR747XbRNreppY2PqEZh5Nu6TE94xcJQ`
  - `initialP2WPKH` (SingletonBeacon): `bcrt1q9mx376n875wlsu33emevrl5ag5xllsw7r3nlv6`
  - `initialP2TR` (SingletonBeacon): `bcrt1pdhlxv0242wkefugfkeu9jxwhdms4xe2u4fsarc9j6h7554u8xysswqed7k`

### n05-x1-missing-update-data

- **DID:** `did:btcr2:x1qfuuz6h4mxgj04g6w8hg4uhk3caf9uzrwfvjapxcxe29tujry0hw5dhg2t8`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mmvZQQ9GciR93hYfbkaQtyVBT6EV1pN55j`
  - `initialP2WPKH` (SingletonBeacon): `bcrt1qger6zvhnetkg2y25rl0ctnq797p7zqgryf288q`
  - `initialP2TR` (SingletonBeacon): `bcrt1pdsvvrw0skgcep7j302jd0fmzkj80xmn9dcnrrj3cmhv2f22whr7qylkqw5`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `bcrt1qger6zvhnetkg2y25rl0ctnq797p7zqgryf288q`

### n10-k1-invalid-update-context-member

- **DID:** `did:btcr2:k1qgp040juug4k0ml7306utyz3sx7zg04t22wzlpmvmey5we48gk8ytfsmr5a2s`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `ms9ykJxfrQjqTxHFruUvbQn4nBKs5biaQh`
  - `initialP2WPKH` (SingletonBeacon): `bcrt1q075legkpsqpa9mskt3wk6a4ylzt6unnnfrru2h`
  - `initialP2TR` (SingletonBeacon): `bcrt1prgl343jtt9t6y5ss64kwgnj5fy5yvj4gkunhryc7yljde9vksrfqqqay3z`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `bcrt1q075legkpsqpa9mskt3wk6a4ylzt6unnnfrru2h`

### n11-k1-invalid-update-context-order

- **DID:** `did:btcr2:k1qgpejq0v0svp3gccwh20v2mgsaa8rfmq5ktelyzsjuq0hqs90fj3kys5zjflx`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mpj2bGiCyRU71VW8UzHnvftQsHquYSH54x`
  - `initialP2WPKH` (SingletonBeacon): `bcrt1qv5qmthk9nw7s0waxp56m7cq5ntuspecc4zwmh8`
  - `initialP2TR` (SingletonBeacon): `bcrt1pnl6eusexmlzk3ufslx79pwqxcp395xvly7r7snjcu82r7ysdwlzqkhhe5u`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `bcrt1qv5qmthk9nw7s0waxp56m7cq5ntuspecc4zwmh8`

### n12-k1-invalid-update-proof-context

- **DID:** `did:btcr2:k1qgpnkulnyxrsw73csr5htq3vqqhp6lr6r0fsetrmk0jw2xf6nn98eucdlch3e`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mtJSL9YmkdS6gXarvQZtioBc2izkPbURu2`
  - `initialP2WPKH` (SingletonBeacon): `bcrt1q3sa6rrrt0wyfnnyj9pnau5h9nsulj2j2c6vres`
  - `initialP2TR` (SingletonBeacon): `bcrt1pya5dr0dd2254fy6z8ex0hlt5gaa06099g5nl2e852zwcsphw8n4s0k9ct5`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `bcrt1q3sa6rrrt0wyfnnyj9pnau5h9nsulj2j2c6vres`

### n13-k1-invalid-update-capability-action

- **DID:** `did:btcr2:k1qgpf5yjw78ulg88tt4mu56nv9uca0eqn4m3udr3agur3qdk0za8mmwqhk02m4`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mfcfgToSkyHuSSuTYLnCbRdumCf6KPTYSA`
  - `initialP2WPKH` (SingletonBeacon): `bcrt1qqy22p8tjxdysqgh7wc8ly3gacd324s5v8lvjwv`
  - `initialP2TR` (SingletonBeacon): `bcrt1pywjfhmf6vwraukv6c22lma7eu79qte9qmy9lrzfueg6udsazyjhs0dg55n`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `bcrt1qqy22p8tjxdysqgh7wc8ly3gacd324s5v8lvjwv`

### n14-k1-invalid-update-capability-encoding

- **DID:** `did:btcr2:k1qgpw65qy7gszey64424hmygs4dm99e0dzqayxqgsmpvp699erydsxaq6xucna`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mvtEGQ2KVwxRS2NzmFMroLzTMTXH8MCrmk`
  - `initialP2WPKH` (SingletonBeacon): `bcrt1q4z8lgj2hv99azjat3zvv2vyqupt7mt9k92a0tm`
  - `initialP2TR` (SingletonBeacon): `bcrt1pv90ax2hhu2ssmkqmnsj6f9f994ecxr6sm8wgfkd7kg2vmln3gfhs48cjjc`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `bcrt1q4z8lgj2hv99azjat3zvv2vyqupt7mt9k92a0tm`

### n15-k1-invalid-update-proof-purpose

- **DID:** `did:btcr2:k1qgp6fp4d4kfhag9zh2ey2fgqjtgnzqlj7xujc4a65ds5a0zurjmagvsrye745`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `moHHvatYBybyqrokHpFj47YivHqX2x4RZN`
  - `initialP2WPKH` (SingletonBeacon): `bcrt1q254er2rznuas3aw8szfl22q6r52gu9v3c6ulra`
  - `initialP2TR` (SingletonBeacon): `bcrt1p402y5tuqlpg9pmx96v4m4n8kcdwej66q99z5cgq0xg9wa3mgdwtsn2zf6n`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `bcrt1q254er2rznuas3aw8szfl22q6r52gu9v3c6ulra`

### n16-x1-invalid-update-unauthorized-method

- **DID:** `did:btcr2:x1qty0lp74nvyt75dnx32p3pr5s4ja0nt3uc8r05u6cdxwxmrc706exfupn82`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mwijmpcgSiv6m7kPeMnwygGZWksPUHGAzB`
  - `initialP2WPKH` (SingletonBeacon): `bcrt1qkx7g63upvsncejwv0cajfktmd78tse7w6s5lyr`
  - `initialP2TR` (SingletonBeacon): `bcrt1pjfp6p8z0ygye62ychdcay6dwntla5jd4rat59xsjs9d6cse5m4ys5npt0v`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `bcrt1qkx7g63upvsncejwv0cajfktmd78tse7w6s5lyr`

### n17-k1-invalid-update-unknown-method

- **DID:** `did:btcr2:k1qgp5wcmx75cg6e68s6mv8ell4x333t2d0qknvkyls6jpz5k48u6wlac5ez3uf`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mz3CPkF52QiL2YkL2jh7HrTfwWy2jFTHep`
  - `initialP2WPKH` (SingletonBeacon): `bcrt1qev4g9ud9qpp9r0m8g9qk4zzccht4cyc0max0lp`
  - `initialP2TR` (SingletonBeacon): `bcrt1pe9cvmqg0xhkflku9zdnsjctfa9g82js69ydgux4y6lf3z9apc8gqkyxjuu`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `bcrt1qev4g9ud9qpp9r0m8g9qk4zzccht4cyc0max0lp`

### n18-k1-invalid-update-proof-value

- **DID:** `did:btcr2:k1qgp2ht79cm5ls3hccw38csqsmxw54t4kxm9kxakyv3melkffmz63eag9atl3m`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `miXXnHPjDER3avJ8P1riYuZCV9MLrRS4P8`
  - `initialP2WPKH` (SingletonBeacon): `bcrt1qyyz9ffdy8y7yj6ywlw4u2c6dyaksmadf5mud4n`
  - `initialP2TR` (SingletonBeacon): `bcrt1p57xqvdu5d3sp30v2s4w3l4d53fxcprnmpndclkuuaxsx8ch5l8gq4jngd6`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `bcrt1qyyz9ffdy8y7yj6ywlw4u2c6dyaksmadf5mud4n`

### n19-k1-invalid-update-source-hash

- **DID:** `did:btcr2:k1qgpmreat5m9tvmr9z784v9aqlr9l0dx9lmc3v4zm5wnxq2vjaswzvxg52dwdf`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mgnvzbTZfiuD58tS216pj2gG83623F7oty`
  - `initialP2WPKH` (SingletonBeacon): `bcrt1qph7mrarkt3v5rw8fvgvdelncc9g30c9a9u0c8x`
  - `initialP2TR` (SingletonBeacon): `bcrt1pytrcuhfu8eagj0wcsvshukpf47jr39a6g2dcmu7fdrykhktjjs8q8tlv7a`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `bcrt1qph7mrarkt3v5rw8fvgvdelncc9g30c9a9u0c8x`

### n20-k1-invalid-update-target-hash

- **DID:** `did:btcr2:k1qgp3e09g3m0y64xp3kqhzs09kfra4202vmuftq2n7nuhs3qeuysx8hslgzduh`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `myKMQpmUvWCS9etQdcUZpk3EvxwzajGUXZ`
  - `initialP2WPKH` (SingletonBeacon): `bcrt1qcdqfr3h8tnmdry006dd70fzt6hpnpwdxuk6q7c`
  - `initialP2TR` (SingletonBeacon): `bcrt1pl30phulh5wluvsa887rwejag7sn250wrjw0yepcz2y6fpdjxnw2s97t38k`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `bcrt1qcdqfr3h8tnmdry006dd70fzt6hpnpwdxuk6q7c`

### n21-k1-invalid-update-version-skip

- **DID:** `did:btcr2:k1qgpxl5uu5dqgef2r73syfq5sq6z97zjgp4l3vqcg2j8atk784plu80qgql87z`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mujrv1PEEtmVvqDUfgGB72A7uYXDWtxmgN`
  - `initialP2WPKH` (SingletonBeacon): `bcrt1qnsp2668lre5sdmczeyhv7jddwyvgf45e8a0t3n`
  - `initialP2TR` (SingletonBeacon): `bcrt1p65ccfz3rdes2x2mk98x4uyeykf80vwhzrzujgt6wgpp6xa8yj46sgzk4p4`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `bcrt1qnsp2668lre5sdmczeyhv7jddwyvgf45e8a0t3n`

### n22-k1-invalid-update-patch-missing-path

- **DID:** `did:btcr2:k1qgp5fh0eg6edzah0fkzxlrl36ql2746rkal60mzelj7adasfvwjdlhsqw8ljd`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mnNE3mYPxk243Prav6B7fdPUbFZrHQqzSs`
  - `initialP2WPKH` (SingletonBeacon): `bcrt1qfv3ynyzmm7tsc7elsxlmkyjmmcxakfxulp2xrm`
  - `initialP2TR` (SingletonBeacon): `bcrt1pwxm73v3k0gvhtred4qc2hj3aq6v5j48p7e03u827pkulq5hufelscud2k6`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `bcrt1qfv3ynyzmm7tsc7elsxlmkyjmmcxakfxulp2xrm`

### n23-k1-invalid-update-patch-changes-id

- **DID:** `did:btcr2:k1qgpl0zenjt5zrhzm9r9wq7nmjjth7lwsxzy9mkllxwyaljx5teh4p6sgkd6hz`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mopFz3vr7ZNigwNySZGRYPNkEgwU1qQzAf`
  - `initialP2WPKH` (SingletonBeacon): `bcrt1qtvrdsxcpfqfdwtvpm8fzfw6tu76fe9rdm05y4z`
  - `initialP2TR` (SingletonBeacon): `bcrt1p6gqyyvrmjzwylfn8vvlnzje44l9cuhnpqmkgk465sw8jk6kd800qcx2aep`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `bcrt1qtvrdsxcpfqfdwtvpm8fzfw6tu76fe9rdm05y4z`

### n24-k1-invalid-update-patch-invalid-document

- **DID:** `did:btcr2:k1qgpq3zd0f7kgruwy3ra3hkwh72kyfw25prujvcvpjw43rc6ylndkptsld8e5m`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `n239oudpizwpg4HnmWw3yyMdoRs5auGset`
  - `initialP2WPKH` (SingletonBeacon): `bcrt1quyvfk3j8958qu3j2rwjm2lgqjdw63rdxtxmh4p`
  - `initialP2TR` (SingletonBeacon): `bcrt1p9aru6y8tnrd8sudz55j3y4j348kn0g4mfkdate628r5lxul2zh6slur3dv`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `bcrt1quyvfk3j8958qu3j2rwjm2lgqjdw63rdxtxmh4p`

### n25-k1-invalid-update-created-after-block

- **DID:** `did:btcr2:k1qgpq4wrg3f75ekkpedexmvxg3yeyeppgd0ct7mpcx0awjmrelewgp5qt2fut8`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mxz5CRiG8WiAvW99W6izXQvb1LYPWKvPzw`
  - `initialP2WPKH` (SingletonBeacon): `bcrt1qh7djrvf4j06y3gn7aeahjpu4h8tacajmc6d9kx`
  - `initialP2TR` (SingletonBeacon): `bcrt1pef2dyc439vghckpj4am3pernu0ulykssjnt9dwyv6n6afzfmnejquscp65`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `bcrt1qh7djrvf4j06y3gn7aeahjpu4h8tacajmc6d9kx`

### n26-k1-invalid-update-expires-before-mediantime

- **DID:** `did:btcr2:k1qgp33y4vgpe4thxha0l2qu6pa2lej98v6z65x6hj35c7a39xad3nw7g3s05kq`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `muVvm1dXQh3oMjnS7GbFESDnYw5VnYLpnu`
  - `initialP2WPKH` (SingletonBeacon): `bcrt1qn9spqspcv0sqreuergj0je7tpjw7u70fgveyjf`
  - `initialP2TR` (SingletonBeacon): `bcrt1pwwlt9nmcendvepp08c88sxh2hzlv326lj4p9lcuem2vxxsz7kdgs766leg`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `bcrt1qn9spqspcv0sqreuergj0je7tpjw7u70fgveyjf`

### n27-k1-invalid-update-expires-before-created

- **DID:** `did:btcr2:k1qgpp9e44h4nla8n03smnlgzpz7tvhxjf9c3uv7420dxzm0zphl5l3xsuafz9v`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `n2Lgi3oxarQ1YaLdBHNHH1wcTD1uFutc7e`
  - `initialP2WPKH` (SingletonBeacon): `bcrt1qu35h39uw64ga95rsqpp30ml8m5dffaxp0qy7ml`
  - `initialP2TR` (SingletonBeacon): `bcrt1pttp7lfvc8clurm4zpqzkk2hrk8czj4x67xgajgfdfst9lv5vu9yq2m8rq2`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `bcrt1qu35h39uw64ga95rsqpp30ml8m5dffaxp0qy7ml`

### n28-k1-late-publishing

- **DID:** `did:btcr2:k1qgpepnx06y54nf8cnftdcq6wkptysutl6h3vdew88nt668jm6efhemqrr5jyp`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `n4HZfgE3Yf3kRkm2hQjQ76xJ769EvUCBDC`
  - `initialP2WPKH` (SingletonBeacon): `bcrt1ql8pf36yg9hue9azjfl0v9ray9yrhamnsf05mlj`
  - `initialP2TR` (SingletonBeacon): `bcrt1psj2putc5zch7trjsn7l0p3egj4jthpmw2758mspx0gd3uess6l0sw7pcgh`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `bcrt1ql8pf36yg9hue9azjfl0v9ray9yrhamnsf05mlj`
  - update 2 at `initialP2PKH` (p2pkh, key genesis): `n4HZfgE3Yf3kRkm2hQjQ76xJ769EvUCBDC`

### n29-x1-smt-proof-hash

- **DID:** `did:btcr2:x1qgncuznqmakha4yqsrzfnz8hzvphxgygvpu8dw4zlj0pnhdexd8p6qx3gfw`
- **Cohort:** smt-25
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mtvRqrCJCRhEsFSRGCcH98tmhBGcjdLuP5`
  - `initialP2WPKH` (SingletonBeacon): `bcrt1qjv9r9jgju4p58qfy700a8du6rjj58q4m9nudzp`
  - `initialP2TR` (SingletonBeacon): `bcrt1pq7uqmmx3ajs3xk3a82j6rghlfsvw7zhmpf8w3smdsc32sjgxp4eqp9xp43`
  - `cohortBeacon` (SMTBeacon): `bcrt1q9cck2y2qyunlevrq264ezxumfwp5dptjhctrhc`

### n30-x1-smt-proof-root-id

- **DID:** `did:btcr2:x1qf0zm452ltcpyq38mxxfz9n5kn6zvx6rph5wnnmk8cllakt9nrpjq4p6lta`
- **Cohort:** smt-25
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mwp2yWvpCPruNQzH762PTcKLiLQqpjkPTm`
  - `initialP2WPKH` (SingletonBeacon): `bcrt1qk270m24hykz9nhy7q52pjjmtmxsfj5n3qwkhhe`
  - `initialP2TR` (SingletonBeacon): `bcrt1pa975yw5cm2n49nk3clhwmu6pss9jr8dx9rl9wj93w4vsxpc8rxcq0l9829`
  - `cohortBeacon` (SMTBeacon): `bcrt1q9cck2y2qyunlevrq264ezxumfwp5dptjhctrhc`

### n31-x1-smt-proof-withheld

- **DID:** `did:btcr2:x1qttq27mlpynx896eccn46l4m8hxa9q0qs7qv35fk7gmw9nxszxm7gp8mvj0`
- **Cohort:** smt-25
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mnnX1BU4MNjTmPmgzfe3fxcR66M29QYhC8`
  - `initialP2WPKH` (SingletonBeacon): `bcrt1qf7axey8c986v4zpzqqag3rmkqge48v94xjdr6w`
  - `initialP2TR` (SingletonBeacon): `bcrt1ppqvtcxcvcevd9fch3ffe3wngdpm5weafx6gdp0tzu29recxwf5us9zspak`
  - `cohortBeacon` (SMTBeacon): `bcrt1q9cck2y2qyunlevrq264ezxumfwp5dptjhctrhc`

