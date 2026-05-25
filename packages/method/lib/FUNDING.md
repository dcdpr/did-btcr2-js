# Test Vector Funding Targets

Generated across 16 scenarios. 13 have updates and need at least one beacon funded; 3 are no-update vectors (data-only).

## Needs funding (P2WPKH, cheapest to spend from)

Cohort members (09-12) share ONE beacon address per cohort: fund it once and the single OP_RETURN covers every member. Solo update scenarios fund their own P2WPKH singleton.

| Scenario | Network | Cohort | Beacon address |
|----------|---------|--------|----------------|
| 02-k1-sidecar-update | mutinynet | - | `tb1qe205pjg8ptvay643m47h2f0e73k0yzwv00suar` |
| 04-x1-sidecar-update | mutinynet | - | `tb1qmesfxemj4stmpfa7zkpx5hkwvm3lc8j3q7jxhr` |
| 06-x1-cas-3-updates | mutinynet | - | `tb1qrtpcqmqey5af77sfet4n6ep378u444jsqu05xd` |
| 07-k1-sidecar-deactivate | mutinynet | - | `tb1q7mss0haz2pjzh6kry4ythrat3mpk4rj5hhgy4l` |
| 08-x1-cas-update-deactivate | mutinynet | - | `tb1qqkfhq42y2wsfzds7ymrvdkas0taegv49jqsrq5` |
| 09a-x1-cas-update-announcement | mutinynet | cas-09 | `tb1qmhshwy0hpjaglmqagncedv86wyalc0u8mzxz03` |
| 09b-x1-cas-update-announcement-paired | mutinynet | cas-09 | `tb1qmhshwy0hpjaglmqagncedv86wyalc0u8mzxz03` |
| 10a-x1-sidecar-update-cas-announcement | mutinynet | cas-10 | `tb1qt4zug3aye78fmcz6ah02rdyg87q4fhma03ggf5` |
| 10b-x1-sidecar-update-cas-announcement-paired | mutinynet | cas-10 | `tb1qt4zug3aye78fmcz6ah02rdyg87q4fhma03ggf5` |
| 11a-x1-cas-update-smt-proof | mutinynet | smt-11 | `tb1q0h4akfmd873fkwgwp590c75qfgdfh856v4fye4` |
| 11b-x1-cas-update-smt-proof-paired | mutinynet | smt-11 | `tb1q0h4akfmd873fkwgwp590c75qfgdfh856v4fye4` |
| 12a-x1-sidecar-update-smt-proof | mutinynet | smt-12 | `tb1qs2fzk3x6xtl9hxumrud94ytj6vystqskk2s597` |
| 12b-x1-sidecar-update-smt-proof-paired | mutinynet | smt-12 | `tb1qs2fzk3x6xtl9hxumrud94ytj6vystqskk2s597` |

### Plain list (9 unique addresses, one per line, for piping into a script)

```
tb1qe205pjg8ptvay643m47h2f0e73k0yzwv00suar
tb1qmesfxemj4stmpfa7zkpx5hkwvm3lc8j3q7jxhr
tb1qrtpcqmqey5af77sfet4n6ep378u444jsqu05xd
tb1q7mss0haz2pjzh6kry4ythrat3mpk4rj5hhgy4l
tb1qqkfhq42y2wsfzds7ymrvdkas0taegv49jqsrq5
tb1qmhshwy0hpjaglmqagncedv86wyalc0u8mzxz03
tb1qt4zug3aye78fmcz6ah02rdyg87q4fhma03ggf5
tb1q0h4akfmd873fkwgwp590c75qfgdfh856v4fye4
tb1qs2fzk3x6xtl9hxumrud94ytj6vystqskk2s597
```

## All beacon addresses per scenario

In case you want to fund a different address type per scenario.

### 01-k1-base

- **DID:** `did:btcr2:k1q5pmgrmm24muzqafndghvmdhphfq8eszyygeucdy8gcsep9yvl4y2zc4rd8yh`
- **Network:** mutinynet
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mhdJv2waKDuaVpemhjzHMjC6uHgYHUCGUN`
  - `initialP2WPKH` (SingletonBeacon): `tb1qzu3ltkx8cjj2x2tsqq5p3k92wp54fyey9n8yjr`
  - `initialP2TR` (SingletonBeacon): `tb1p9gl405d4fpn2kyxe3c7da8f9xqwmp0lq93shvghxzd0alt3x64vqz583my`

### 02-k1-sidecar-update

- **DID:** `did:btcr2:k1q5pgeu9zsdnzc7ch6emhrq7ay039fzezd6wqy0e5qwp6dq73zl8dwqsm20uug`
- **Network:** mutinynet
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `myzKZuCoGmbMCqyZPo8CaGd7Bw44LzQFYX`
  - `initialP2WPKH` (SingletonBeacon): `tb1qe205pjg8ptvay643m47h2f0e73k0yzwv00suar`
  - `initialP2TR` (SingletonBeacon): `tb1pyptmn5h4zxvwe450ptgl38pfaajpks065tf8j83p900qpa7u5l3q0mumep`

### 03-x1-base

- **DID:** `did:btcr2:x1qks3nmd370337a4pynypn2d4wslz82pek440dwerltlk5hwu63vsu9s0rjt`
- **Network:** mutinynet
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mv5RvjbXLL4kWXnKiZDtnJ9SxZBVABTnLc`
  - `initialP2WPKH` (SingletonBeacon): `tb1qn7mzxht5cwtujertakk95c0s6jpfevpq70as0n`
  - `initialP2TR` (SingletonBeacon): `tb1pu8930l0tcpdl30udulwu8zrxe7wcgfkh6jdru0q9086w968nzgps8vq87s`

### 04-x1-sidecar-update

- **DID:** `did:btcr2:x1q5ugrf3wc7ll637ytylvy4gg4l4k9nvl3pvg2ud7rmclgyytcer8crrtxnh`
- **Network:** mutinynet
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `n1nmzqvq4FpvHT12Vu53rbrhC1TYJH8YHh`
  - `initialP2WPKH` (SingletonBeacon): `tb1qmesfxemj4stmpfa7zkpx5hkwvm3lc8j3q7jxhr`
  - `initialP2TR` (SingletonBeacon): `tb1pywqrunvtz7kxe0sl204fl45pnj8083jjhjwjrp76zku88erry2ysyvzr9p`

### 05-x1-no-beacon

- **DID:** `did:btcr2:x1qhz4ld6el4lgsq8pzc76v98v3nge4gn90s9p4sngf559pv97xa4vga03uje`
- **Network:** mutinynet
- _(no beacon services in this DID's document)_

### 06-x1-cas-3-updates

- **DID:** `did:btcr2:x1qky9e7qzf6chare8j97e43zuqe5ge8cvnya0rmcjkzrfsq8zge09xmp8xcg`
- **Network:** mutinynet
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mhxU4jYctApZCfJs7c54v36D6nccusbgGx`
  - `initialP2WPKH` (SingletonBeacon): `tb1qrtpcqmqey5af77sfet4n6ep378u444jsqu05xd`
  - `initialP2TR` (SingletonBeacon): `tb1p8ccnpr54yrh2lwacln70ukylvauqqhp2m029tp0jgxxtrlfc2y7qx05xze`

### 07-k1-sidecar-deactivate

- **DID:** `did:btcr2:k1q5p6w9suggq435yx5h9mav06ksp9ptsu4aqmr05xuc0ufz6nhgn3f5q8r9w8l`
- **Network:** mutinynet
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `n42L6exqrTmGVsVvozxb2ySJk4qqEL6jFi`
  - `initialP2WPKH` (SingletonBeacon): `tb1q7mss0haz2pjzh6kry4ythrat3mpk4rj5hhgy4l`
  - `initialP2TR` (SingletonBeacon): `tb1pgccp98gm4l77pdmcxxv4j7ps69lkwmj8r5ms4lfzrfc6pqfeckhqf63hce`

### 08-x1-cas-update-deactivate

- **DID:** `did:btcr2:x1q5m2fh36z4gum46ax2l8fvh98e4eh5yqm02ry6aetjk2hwl0q5kfs9tezg7`
- **Network:** mutinynet
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mg2SJEurFj7oatTT8jm7GG8VkEkrfHHo3U`
  - `initialP2WPKH` (SingletonBeacon): `tb1qqkfhq42y2wsfzds7ymrvdkas0taegv49jqsrq5`
  - `initialP2TR` (SingletonBeacon): `tb1p6txyw8zn0qdxtnf6k5dqe2zh20949x39gwpkhd5d2klms05vwegsedastt`

### 09a-x1-cas-update-announcement

- **DID:** `did:btcr2:x1q4x4pxl2uztzph2ulg39at0ad93v622gfjpgtafzjck6nxylcst9x3k2jf3`
- **Network:** mutinynet
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mg74KVPYhR9NPjYkxL3a69wsoFxrjomXzN`
  - `initialP2WPKH` (SingletonBeacon): `tb1qqeejcqhwmt8g60gg2q8ydm8jh7dfqsf9pj03ta`
  - `initialP2TR` (SingletonBeacon): `tb1p5d3d4aqh8wtewwunw46qdecw8dxs53lryv2spsr7ph0j468l8fqqu94aze`
  - `cohortBeacon` (CASBeacon): `tb1qmhshwy0hpjaglmqagncedv86wyalc0u8mzxz03`

### 09b-x1-cas-update-announcement-paired

- **DID:** `did:btcr2:x1q59jnwfs6pc6metzrkg96l5kpenql3tla8knc9gv7233gwgnr6057mhcrnj`
- **Network:** mutinynet
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mqKYUeJ23uf2o9gfcyYVv8DNkFZamcS5fv`
  - `initialP2WPKH` (SingletonBeacon): `tb1qdwyvemp55uctdu6m6n6vxmweks0x0t8ckezahf`
  - `initialP2TR` (SingletonBeacon): `tb1pekpys3khg28d2qenlh7d4x4c2tyed57c3zeygkf86hqykrupe78qzhlk2e`
  - `cohortBeacon` (CASBeacon): `tb1qmhshwy0hpjaglmqagncedv86wyalc0u8mzxz03`

### 10a-x1-sidecar-update-cas-announcement

- **DID:** `did:btcr2:x1q550pp4es065j473wh4hhwu5p8quduwxfg8t2v8knff27qhn98wrjl3wscf`
- **Network:** mutinynet
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `msGhQRkoBAKR7rCddeKnhP97esmo8y9gg7`
  - `initialP2WPKH` (SingletonBeacon): `tb1qsrh5r8g9uzf2ve7n9ehnxy52ftvtam6l4ehqtj`
  - `initialP2TR` (SingletonBeacon): `tb1pfxnfgns8uvqrezwckspm8nm3n4c36kv36mru43y7ks6alw8axrtsc9dwu6`
  - `cohortBeacon` (CASBeacon): `tb1qt4zug3aye78fmcz6ah02rdyg87q4fhma03ggf5`

### 10b-x1-sidecar-update-cas-announcement-paired

- **DID:** `did:btcr2:x1qkrrp544p6yv3mxawqs2m8dtmh06p42pxvyjun9zs69qv46ytw4lukwu6zy`
- **Network:** mutinynet
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mx8hWRz3qvZT8g6qigiUDFBCJcZubxuU1S`
  - `initialP2WPKH` (SingletonBeacon): `tb1qkez2fkgm9dtkvmq2gs3w2r4ujhmuqrmg9z52ac`
  - `initialP2TR` (SingletonBeacon): `tb1ppn8zq8kpaawxm5mpaggqmjx6qwnuu0s9agah750nlj92gexg666qsfpvp5`
  - `cohortBeacon` (CASBeacon): `tb1qt4zug3aye78fmcz6ah02rdyg87q4fhma03ggf5`

### 11a-x1-cas-update-smt-proof

- **DID:** `did:btcr2:x1q4lqu6grp3gez4gh0yfrv3x3p2cqdgmm24wgh9p6kq0hm0vltg0m6kxaqsq`
- **Network:** mutinynet
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mgWHp8LGfn4BAyciL43cRjmeGnmuncvKLs`
  - `initialP2WPKH` (SingletonBeacon): `tb1qptvqp37xk98af7rmtw6gjqdm0dmjrhxjkty8x6`
  - `initialP2TR` (SingletonBeacon): `tb1ppcc6mqalxut4q48avrfs0trfm753cvxslalvd08t8h59slrvmkqq8lj6ke`
  - `cohortBeacon` (SMTBeacon): `tb1q0h4akfmd873fkwgwp590c75qfgdfh856v4fye4`

### 11b-x1-cas-update-smt-proof-paired

- **DID:** `did:btcr2:x1q4rnhfhvv076pd2wzftkrz7426wky2h3a95aatwne3ujsa30pcjhyzmlyn7`
- **Network:** mutinynet
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mi4rkSnuNFF4158wk9pwk3M2to2t2Fz2uF`
  - `initialP2WPKH` (SingletonBeacon): `tb1qr0uw7q55lclv5gzfp0q6ce49agjtqsp47dwpgh`
  - `initialP2TR` (SingletonBeacon): `tb1psc0pfcvyc8pk3rmamwezamqhwy9ypk7k2ngm55ew7tu86893jqsq49kver`
  - `cohortBeacon` (SMTBeacon): `tb1q0h4akfmd873fkwgwp590c75qfgdfh856v4fye4`

### 12a-x1-sidecar-update-smt-proof

- **DID:** `did:btcr2:x1q5cfewepdtyw92pylcgf68k87dz97epx3a2040gayx3jygj2g45fs4peu2c`
- **Network:** mutinynet
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `n1pJoCxYk4WpvfDBPkZMBQP9zu8vmvqmet`
  - `initialP2WPKH` (SingletonBeacon): `tb1qm64t8fh2jj4xyu0hk54xzk5ph27vlw640xfwk7`
  - `initialP2TR` (SingletonBeacon): `tb1plggjx636jyseqj8z3fsueww99vawwzm3wft6de2mspmjpnzx36yqcusaey`
  - `cohortBeacon` (SMTBeacon): `tb1qs2fzk3x6xtl9hxumrud94ytj6vystqskk2s597`

### 12b-x1-sidecar-update-smt-proof-paired

- **DID:** `did:btcr2:x1q425c5wf9a7r3hf4vm6rtxlz4rpapwgcqt9jht8v33mnehp6cs3qku7xtk2`
- **Network:** mutinynet
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mqEZEz4QvU9ua25fxtE4kJxzZhNXjZ9hqr`
  - `initialP2WPKH` (SingletonBeacon): `tb1qd2t4hh8fjhfrkypr0q9qthdya0hsast25t8txp`
  - `initialP2TR` (SingletonBeacon): `tb1p29xfe8es2l25skgcx8m0hcd5eaz4th584xz0r9h5zgm27qfq9nms0uyyyr`
  - `cohortBeacon` (SMTBeacon): `tb1qs2fzk3x6xtl9hxumrud94ytj6vystqskk2s597`

