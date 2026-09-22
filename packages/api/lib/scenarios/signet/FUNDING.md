# Test Vector Funding Targets (signet)

Generated from 59 scenarios: 38 anchor their own beacons, 12 are cohort members (one shared anchor per cohort), 9 need no funding.

## Solo beacon addresses

Each address carries one OP_RETURN per anchor. Fund each address once; the anchor step chains the change.

| Address | Type | Anchors | Scenarios |
|---------|------|---------|-----------|
| `mp7EMFmfptg6R5bbfjaQoG9MpPRgFJkN4b` | p2pkh | 1 | 02-k1-sidecar-update |
| `mi9EaabJC7GyM7waWARXJEgoMBNmEKHuVn` | p2pkh | 1 | 04-x1-sidecar-update |
| `tb1q5wlu55ytuk0ntfkgtpww7vm9wkfn0xup6797kc` | p2wpkh | 3 | 06-x1-cas-3-updates |
| `mzXuvbHLWnAeefvudy7ubShWkKBp6gFhu7` | p2pkh | 1 | 07-k1-sidecar-deactivate |
| `tb1q4adkzkk5yjmdqsj0ckpxgtxat9pslgttexyhxx` | p2wpkh | 2 | 08-x1-cas-update-deactivate |
| `tb1qcgxngzz766y8z8sw45lzpe34p0eyd8g8esshv4` | p2wpkh | 1 | 13-k1-update-p2wpkh |
| `tb1p7g6dmtj3jrnus9u0hsmwjzxhpgnxmkd50nca7zxeau9dyp5aj4gqnp76hg` | p2tr | 1 | 14-k1-update-p2tr |
| `tb1qt8q2sn03hnldk228emy7u2jpeamtjkxyvn9wyw` | p2wpkh | 1 | 15-x1-beacon-rotation |
| `moanHFLffaoSfqWGLrjErv1hZzTSHa9NTj` | p2pkh | 1 | 15-x1-beacon-rotation |
| `tb1qe3anasgd4selx02qwx25jczeejcxyy08096rkv` | p2wpkh | 1 | 16-x1-beacon-add-then-use |
| `tb1qapylzc4mp237wtqw8mn5knz6p288ahpjn0cz5d` | p2wpkh | 1 | 16-x1-beacon-add-then-use |
| `tb1qe7jqx0tdpyffh8l0l777p9hne6w77ghxvn6d47` | p2wpkh | 2 | 17-x1-vm-add-rotate-authentication |
| `tb1qjx4m25etu4gr40ktl8d5mzcky4kl966afjckwd` | p2wpkh | 1 | 18-x1-embedded-invocation-key |
| `tb1qlgpshed5c9tlwazvaqceaacvcunqcr89w2kd6e` | p2wpkh | 1 | 19-x1-relative-ids |
| `tb1qfeyv0xyas279aa4tu4jppeaaadukqpm49fsq5x` | p2wpkh | 1 | 20-k1-cas-update |
| `tb1qnqrk6erydu0qulwaal823jsfalwps3upuk26n2` | p2wpkh | 2 | 21-k1-deactivate-then-update |
| `tb1qpn52da7ch53kcamqacm97n3h7rtflag7fpmdl9` | p2wpkh | 3 | 22-x1-three-updates-resolution-options |
| `tb1qpxanl8t3nkq6ttfpe54eudd06v5660x2ppfdm4` | p2wpkh | 3 | 23-k1-duplicate-signal |
| `tb1qpfn5kwug6xrh8g8w73js9zj8qm842866suuqd3` | p2wpkh | 1 | 24-k1-removed-beacon-signal |
| `mgTxnxShbm8qfQ6C5ybUPZnhehCCfYnUN5` | p2pkh | 1 | 24-k1-removed-beacon-signal |
| `tb1qzwl5prvn8fy4lhx49wencv74wq47gtmfq4aaqc` | p2wpkh | 1 | 26-k1-signal-below-current-height |
| `tb1qh334pkj6hc7d76d8rqvhqph9h9zhzctdc7lsc7` | p2wpkh | 1 | 26-k1-signal-below-current-height |
| `tb1q4w9wff7k2daczf2jj7uch49hyuq9g85a6k7ne2` | p2wpkh | 1 | n05-x1-missing-update-data |
| `tb1q5xzd73ukge7v9dzyj7qjcwygxzh3083mshjlr2` | p2wpkh | 1 | n10-k1-invalid-update-context-member |
| `tb1qy9sln62ze0gffvsda0xxe9a7fakqx5jqs2sjyt` | p2wpkh | 1 | n11-k1-invalid-update-context-order |
| `tb1qvdu2xquewfuuqur72g9la7kcjryxy4cf4ymrxd` | p2wpkh | 1 | n12-k1-invalid-update-proof-context |
| `tb1qam3jkdcgd6gqpr2q5k20vtp0nx3jk4wnnh742x` | p2wpkh | 1 | n13-k1-invalid-update-capability-action |
| `tb1qtavgg2wu42d9l8jae6dz5yccds86ntj5s77rcx` | p2wpkh | 1 | n14-k1-invalid-update-capability-encoding |
| `tb1qxq4cg5fv894jh9rl2amyyh70rg7llljyxw59hm` | p2wpkh | 1 | n15-k1-invalid-update-proof-purpose |
| `tb1qlq5t6ph065eqxmtqvu38zvw7qt7dhllt2e7nsr` | p2wpkh | 1 | n16-x1-invalid-update-unauthorized-method |
| `tb1q7jhetcnyry4j74q4tyfy2x8r8wvzzhsecmq7a7` | p2wpkh | 1 | n17-k1-invalid-update-unknown-method |
| `tb1qyqqa44wqr9sfk4etc2sw9mypr68tnvhkj7wy4e` | p2wpkh | 1 | n18-k1-invalid-update-proof-value |
| `tb1qj5pq25l76sc2y6taqs82ellcs02jruq2qecqgv` | p2wpkh | 1 | n19-k1-invalid-update-source-hash |
| `tb1qf530yfl73j5xayufz6zcga90l67r0trdz68xv2` | p2wpkh | 1 | n20-k1-invalid-update-target-hash |
| `tb1qdee6qu8j0qldthz8h3x3n2awxa5ve997tyt52k` | p2wpkh | 1 | n21-k1-invalid-update-version-skip |
| `tb1qt8396h7r79c2lmj226h44huhxe6tyd0mjavhr5` | p2wpkh | 1 | n22-k1-invalid-update-patch-missing-path |
| `tb1q40lgnapgntu80k8cjwjmq043fmept3tv8wcuye` | p2wpkh | 1 | n23-k1-invalid-update-patch-changes-id |
| `tb1qpa08u6dmew4dmfp3ct36a24dm2wszf2r6gvxam` | p2wpkh | 1 | n24-k1-invalid-update-patch-invalid-document |
| `tb1qefja3p9cvlflvgtw7j7skfzg5dzr3h7jza9t3k` | p2wpkh | 1 | n25-k1-invalid-update-created-after-block |
| `tb1qgu4su3lvz0ckyj2j8w3p0cpfam8gwyq6ckslm9` | p2wpkh | 1 | n26-k1-invalid-update-expires-before-mediantime |
| `tb1qdghkrpectn5valv7p3dzgknz48whgg20seelux` | p2wpkh | 1 | n27-k1-invalid-update-expires-before-created |
| `tb1qg7w6rc5xgxm97l2ef2x5xz99lkv6x9y0fc0gkg` | p2wpkh | 1 | n28-k1-late-publishing |
| `mn3d7AP5t8nfF2so3NW5XHAbidxgxeZTjG` | p2pkh | 1 | n28-k1-late-publishing |

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
mp7EMFmfptg6R5bbfjaQoG9MpPRgFJkN4b
mi9EaabJC7GyM7waWARXJEgoMBNmEKHuVn
tb1q5wlu55ytuk0ntfkgtpww7vm9wkfn0xup6797kc
mzXuvbHLWnAeefvudy7ubShWkKBp6gFhu7
tb1q4adkzkk5yjmdqsj0ckpxgtxat9pslgttexyhxx
tb1qcgxngzz766y8z8sw45lzpe34p0eyd8g8esshv4
tb1p7g6dmtj3jrnus9u0hsmwjzxhpgnxmkd50nca7zxeau9dyp5aj4gqnp76hg
tb1qt8q2sn03hnldk228emy7u2jpeamtjkxyvn9wyw
moanHFLffaoSfqWGLrjErv1hZzTSHa9NTj
tb1qe3anasgd4selx02qwx25jczeejcxyy08096rkv
tb1qapylzc4mp237wtqw8mn5knz6p288ahpjn0cz5d
tb1qe7jqx0tdpyffh8l0l777p9hne6w77ghxvn6d47
tb1qjx4m25etu4gr40ktl8d5mzcky4kl966afjckwd
tb1qlgpshed5c9tlwazvaqceaacvcunqcr89w2kd6e
tb1qfeyv0xyas279aa4tu4jppeaaadukqpm49fsq5x
tb1qnqrk6erydu0qulwaal823jsfalwps3upuk26n2
tb1qpn52da7ch53kcamqacm97n3h7rtflag7fpmdl9
tb1qpxanl8t3nkq6ttfpe54eudd06v5660x2ppfdm4
tb1qpfn5kwug6xrh8g8w73js9zj8qm842866suuqd3
mgTxnxShbm8qfQ6C5ybUPZnhehCCfYnUN5
tb1qzwl5prvn8fy4lhx49wencv74wq47gtmfq4aaqc
tb1qh334pkj6hc7d76d8rqvhqph9h9zhzctdc7lsc7
tb1q4w9wff7k2daczf2jj7uch49hyuq9g85a6k7ne2
tb1q5xzd73ukge7v9dzyj7qjcwygxzh3083mshjlr2
tb1qy9sln62ze0gffvsda0xxe9a7fakqx5jqs2sjyt
tb1qvdu2xquewfuuqur72g9la7kcjryxy4cf4ymrxd
tb1qam3jkdcgd6gqpr2q5k20vtp0nx3jk4wnnh742x
tb1qtavgg2wu42d9l8jae6dz5yccds86ntj5s77rcx
tb1qxq4cg5fv894jh9rl2amyyh70rg7llljyxw59hm
tb1qlq5t6ph065eqxmtqvu38zvw7qt7dhllt2e7nsr
tb1q7jhetcnyry4j74q4tyfy2x8r8wvzzhsecmq7a7
tb1qyqqa44wqr9sfk4etc2sw9mypr68tnvhkj7wy4e
tb1qj5pq25l76sc2y6taqs82ellcs02jruq2qecqgv
tb1qf530yfl73j5xayufz6zcga90l67r0trdz68xv2
tb1qdee6qu8j0qldthz8h3x3n2awxa5ve997tyt52k
tb1qt8396h7r79c2lmj226h44huhxe6tyd0mjavhr5
tb1q40lgnapgntu80k8cjwjmq043fmept3tv8wcuye
tb1qpa08u6dmew4dmfp3ct36a24dm2wszf2r6gvxam
tb1qefja3p9cvlflvgtw7j7skfzg5dzr3h7jza9t3k
tb1qgu4su3lvz0ckyj2j8w3p0cpfam8gwyq6ckslm9
tb1qdghkrpectn5valv7p3dzgknz48whgg20seelux
tb1qg7w6rc5xgxm97l2ef2x5xz99lkv6x9y0fc0gkg
mn3d7AP5t8nfF2so3NW5XHAbidxgxeZTjG
```

## All beacon addresses per scenario

### 01-k1-base

- **DID:** `did:btcr2:k1qyp62qttvcs2kaku8m02gq8zeqhslcg5tp27nh0awfnj5jf5ffrns5c7gsvmx`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `n2H7QeGj55Y7o4LcS8cNsfxHbPDTJXG3zF`
  - `initialP2WPKH` (SingletonBeacon): `tb1quw7xeaueawk2qvgasa2z5u3alucmlfre3s4fa5`
  - `initialP2TR` (SingletonBeacon): `tb1pjgwq6yfkce6pqz55mntknt8wxa993ujdsrduvnh0a8fje094zwdq6us2nt`

### 02-k1-sidecar-update

- **DID:** `did:btcr2:k1qyp5h7kz6jtdqwmyun3n7rkfe9t84xefez6pcyrzhu279luh4z3h5fq7qf88q`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mp7EMFmfptg6R5bbfjaQoG9MpPRgFJkN4b`
  - `initialP2WPKH` (SingletonBeacon): `tb1qtc7g6xwd40cjw0swmhp87xsuev65hmjy67atqn`
  - `initialP2TR` (SingletonBeacon): `tb1pcx4dnsqkpavwv4nk9t4t8yg4vecdwphfqjnvwc4y5kkqn3md38csjxktar`
- Anchors:
  - update 1 at `initialP2PKH` (p2pkh, key genesis): `mp7EMFmfptg6R5bbfjaQoG9MpPRgFJkN4b`

### 03-x1-base

- **DID:** `did:btcr2:x1q9kv6m73y2xhchg7dd4dhlfvl45dyyvnrxjdyfptnuudvvhgwz0zkj6v685`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mxz7dtAAtShLAxPhgZ5iTPn8WEA8mSAZMu`
  - `initialP2WPKH` (SingletonBeacon): `tb1qh7wj4cf28u7h5c8700de9zjqhrv30gaytdclxk`
  - `initialP2TR` (SingletonBeacon): `tb1plxe38lq36kwg3fwclxnz4k0wu48rq8k5752aheypsrj78lf3sx4qmtmq3d`

### 04-x1-sidecar-update

- **DID:** `did:btcr2:x1q98uadmd2ygyfe48mmsdhj0yjr40ws9h56er49jhr8zsu7lzztdrq2gvxkn`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mi9EaabJC7GyM7waWARXJEgoMBNmEKHuVn`
  - `initialP2WPKH` (SingletonBeacon): `tb1qrnxdraneajlf3zj2lhgh4zlah0a5ydn2lxjrdr`
  - `initialP2TR` (SingletonBeacon): `tb1phl7z60m2mp7ac7kz9czmt82za6as9c5f6x5yd7lxhha83y4lr4es3meh23`
- Anchors:
  - update 1 at `initialP2PKH` (p2pkh, key genesis): `mi9EaabJC7GyM7waWARXJEgoMBNmEKHuVn`

### 05-x1-no-beacon

- **DID:** `did:btcr2:x1q83d7crha649qwnl72pcy5rqfz2tpyu6mexlrkm048r48x5ef3537jckd5m`
- _(no beacon services in this DID document)_

### 06-x1-cas-3-updates

- **DID:** `did:btcr2:x1q82utypv6fvp0f3m99dd7k4cvt6yj40y2xe4h5j9fhl9rpfmx6dfzy7jg2z`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mvSnC9PZJr6fAFsSmiMwArPCVqyKyCjRQG`
  - `initialP2WPKH` (SingletonBeacon): `tb1q5wlu55ytuk0ntfkgtpww7vm9wkfn0xup6797kc`
  - `initialP2TR` (SingletonBeacon): `tb1pg707xztzdhc8hjneyndyhw478qkpp5qqpqy99x805h9n6ey3r63sufvypz`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1q5wlu55ytuk0ntfkgtpww7vm9wkfn0xup6797kc`
  - update 2 at `initialP2WPKH` (p2wpkh, key genesis): `tb1q5wlu55ytuk0ntfkgtpww7vm9wkfn0xup6797kc`
  - update 3 at `initialP2WPKH` (p2wpkh, key genesis): `tb1q5wlu55ytuk0ntfkgtpww7vm9wkfn0xup6797kc`

### 07-k1-sidecar-deactivate

- **DID:** `did:btcr2:k1qyphkqcy5m0znq3nyux4puxl2ewu9gqau8cds4d7h4xzyd78ff4zjwgxu3phw`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mzXuvbHLWnAeefvudy7ubShWkKBp6gFhu7`
  - `initialP2WPKH` (SingletonBeacon): `tb1q6zvd85uxnyz4d5frj4u938q3pqp3xx42h6zahe`
  - `initialP2TR` (SingletonBeacon): `tb1pdgh97j4erflkr0rdxg4a9m6hur8c5u2nykktgmhykz6jz2dl5geslmsz7r`
- Anchors:
  - update 1 at `initialP2PKH` (p2pkh, key genesis): `mzXuvbHLWnAeefvudy7ubShWkKBp6gFhu7`

### 08-x1-cas-update-deactivate

- **DID:** `did:btcr2:x1qxtpqesct5xh68a5da3enf9568tt65ju7kr0v2wl58uplrpl3ulc7rrsney`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mwWA1qaUjDGyP3xGJzPTXW9u8s4H8mSZjk`
  - `initialP2WPKH` (SingletonBeacon): `tb1q4adkzkk5yjmdqsj0ckpxgtxat9pslgttexyhxx`
  - `initialP2TR` (SingletonBeacon): `tb1pvupnyerwka9dh08w4dvnd4v5fv3h0ndd4usdhgrgqu7hnytrhj3sq4hn49`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1q4adkzkk5yjmdqsj0ckpxgtxat9pslgttexyhxx`
  - update 2 at `initialP2WPKH` (p2wpkh, key genesis): `tb1q4adkzkk5yjmdqsj0ckpxgtxat9pslgttexyhxx`

### 09a-x1-cas-update-announcement

- **DID:** `did:btcr2:x1qxs3zu4mmjtjgtjtrx3a08e4fcj3m7ylewy7yv7x60lunltt50vtgzsc57a`
- **Cohort:** cas-09
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mrRAxCRWQxoJHg1NAdTi8JiY7582b4G6fM`
  - `initialP2WPKH` (SingletonBeacon): `tb1qw7ghgdr4tputeu2v2qgsudnpdal0ngpmuwxlxd`
  - `initialP2TR` (SingletonBeacon): `tb1pcs7fzzkypmzsx6qgkswxr7sdnhed7jag3n4mp3a0a0ge4zz3r5zqnmsctq`
  - `cohortBeacon` (CASBeacon): `tb1qaldccwurk5xgvw9tsku86tlx2j8yrmqtztvadh`

### 09b-x1-cas-update-announcement-paired

- **DID:** `did:btcr2:x1qxunyl8237vshu9mz0vakss2nvskdxvhytknzu675hq9s6rj6ruljhqpr8n`
- **Cohort:** cas-09
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mhtvcAuwSJxzrBQzCgcG3X2ypBdEiL7hpR`
  - `initialP2WPKH` (SingletonBeacon): `tb1qrgtlua9d30t4p7nkzcfvhkfp7vzqt42r3s69x0`
  - `initialP2TR` (SingletonBeacon): `tb1pxdq4ycx8wjyknekgxnphw7yalwghp7xz7lgaw6aap24yh6euv6dqhe95cy`
  - `cohortBeacon` (CASBeacon): `tb1qaldccwurk5xgvw9tsku86tlx2j8yrmqtztvadh`

### 10a-x1-sidecar-update-cas-announcement

- **DID:** `did:btcr2:x1q93l6dxt2p29q9vzj2e980yt22p84z77zp2kfmql6h4jp3242c6evut822s`
- **Cohort:** cas-10
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mpsmpfePWhiBAzRHJoBXL4d8nwxw2mrZwp`
  - `initialP2WPKH` (SingletonBeacon): `tb1qv65jqg2u4323tyrx4e68hfq29vslhcsdcm8jrw`
  - `initialP2TR` (SingletonBeacon): `tb1pfssclrp3d9vcm6kwvf6hc7ssc06st3pa6xhtnn5tllkvvyfscx8qvjk9jp`
  - `cohortBeacon` (CASBeacon): `tb1qmrfrnf4n3uktqkugtn5awpkfrsx53njjjgjh5x`

### 10b-x1-sidecar-update-cas-announcement-paired

- **DID:** `did:btcr2:x1q9nhcz2zs9w9m5y7n2wm8wevk0he3vs6wvqgrlruzp60p9uz77jqcshswn5`
- **Cohort:** cas-10
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mv3nMFjdBrFXAUnGkNybynXtYfFxeU1xTB`
  - `initialP2WPKH` (SingletonBeacon): `tb1qnan94vwa5v6329augmh9wahcvpng082sh7djvp`
  - `initialP2TR` (SingletonBeacon): `tb1p2mm020755pnvkuu8lelxr7alp4p24lcpzl5gast4w3d8l6lfr5ws7ntvc9`
  - `cohortBeacon` (CASBeacon): `tb1qmrfrnf4n3uktqkugtn5awpkfrsx53njjjgjh5x`

### 11a-x1-cas-update-smt-proof

- **DID:** `did:btcr2:x1q9wkxze8zaylfsz806utfy8e54gu598d9u5mu3tvwdnam7v9kfp8gr848ke`
- **Cohort:** smt-11
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `n4RRz9B8qxwSYrf3jjGtFWytv6V4q3gmXC`
  - `initialP2WPKH` (SingletonBeacon): `tb1qlvlcx0h0r3gztygpk8s2q4967xgz9e99whw4hy`
  - `initialP2TR` (SingletonBeacon): `tb1p7a32kajs53muw2mznlcyxanu4tazg3p7gezuk0fmv8r5c3fqkv0syzxm2t`
  - `cohortBeacon` (SMTBeacon): `tb1qtawuk37tu2fgymdshxcrum6jrx0dhcmz2egawq`

### 11b-x1-cas-update-smt-proof-paired

- **DID:** `did:btcr2:x1qxsfdgg9j5r8v85sqe4xhjtkjzvjdgjzcvvj96rgqcwu9hsdvfdtsk96aah`
- **Cohort:** smt-11
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mpYdRzHHJCMska6stasSAn17oJVeXLQPv5`
  - `initialP2WPKH` (SingletonBeacon): `tb1qvv9r007cmdealx9qq09e6xaetnsxr38jupxl69`
  - `initialP2TR` (SingletonBeacon): `tb1pey3wqhr375cr8umpplu3s4prppghtzjx8mqkhplpdq4rt6mn6evs8lj4eh`
  - `cohortBeacon` (SMTBeacon): `tb1qtawuk37tu2fgymdshxcrum6jrx0dhcmz2egawq`

### 12a-x1-sidecar-update-smt-proof

- **DID:** `did:btcr2:x1q8sxjrauhntq8ff2ad927w6jskweekuays34xycu2fsut005mn77wa4q9z3`
- **Cohort:** smt-12
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mgv1BisFegxL5iHohBgSYMDNkziLPKyPKG`
  - `initialP2WPKH` (SingletonBeacon): `tb1qpa2pkfn3sg8xnf780m0fv8pjy3n3jgynzecpse`
  - `initialP2TR` (SingletonBeacon): `tb1pgs904mry0nxndygyg4a7u3dcjqjr94nwxgf2aqez5ykw7s48ck6qa42kya`
  - `cohortBeacon` (SMTBeacon): `tb1q30rqk3rxh53p3q4l7wqrlzsmy9gv3uh4v5d2ta`

### 12b-x1-sidecar-update-smt-proof-paired

- **DID:** `did:btcr2:x1qxqfmajnpsh6elpm9wt6pjqvl55gdrnzg5yvn5rftd7rghm28j8dyrt2y4k`
- **Cohort:** smt-12
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mvxHBzdQt6Nn7Zjw8ASwog92n4h7dfpM5j`
  - `initialP2WPKH` (SingletonBeacon): `tb1q492q7x0aqf7tznwmsn2hxjzch26vaqcjgycv8y`
  - `initialP2TR` (SingletonBeacon): `tb1pcqnjzah5fvkascu2vwfrhuw4mnga68gc0skn4tsgx5hmvhlmucjsywwqk9`
  - `cohortBeacon` (SMTBeacon): `tb1q30rqk3rxh53p3q4l7wqrlzsmy9gv3uh4v5d2ta`

### 13-k1-update-p2wpkh

- **DID:** `did:btcr2:k1qypdscmf7s7ef09rv0qhrzfktkhft2ajldyz5d7639hlect7e8gcm5q23d9me`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `myD1CeVSznfoQ3yNa31nVLytXTCDYGY2hB`
  - `initialP2WPKH` (SingletonBeacon): `tb1qcgxngzz766y8z8sw45lzpe34p0eyd8g8esshv4`
  - `initialP2TR` (SingletonBeacon): `tb1pn0qrvpgx33za7cc6r3aus7regvuyvft9zsw00dctfjxp7qkq02sqzg07na`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1qcgxngzz766y8z8sw45lzpe34p0eyd8g8esshv4`

### 14-k1-update-p2tr

- **DID:** `did:btcr2:k1qyprgq5l4k7d6j3pgq7ynmgltggja238h9h0m2aa43343adac48mh5qd40m25`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mjqWGovZRDC6E155oDP3LZQLDT3bSEf63y`
  - `initialP2WPKH` (SingletonBeacon): `tb1q9a327nkqx5qw4arla3g59ar5zv70pev0t86vx5`
  - `initialP2TR` (SingletonBeacon): `tb1p7g6dmtj3jrnus9u0hsmwjzxhpgnxmkd50nca7zxeau9dyp5aj4gqnp76hg`
- Anchors:
  - update 1 at `initialP2TR` (p2tr, key genesis): `tb1p7g6dmtj3jrnus9u0hsmwjzxhpgnxmkd50nca7zxeau9dyp5aj4gqnp76hg`

### 15-x1-beacon-rotation

- **DID:** `did:btcr2:x1q9j6lwt5nq5q56quce694luurd49zhca63ldzzf5acemcuj5nawj275n7ea`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mohXECah63XbnM6ro2zCa5ow9rJ74orXDy`
  - `initialP2WPKH` (SingletonBeacon): `tb1qt8q2sn03hnldk228emy7u2jpeamtjkxyvn9wyw`
  - `initialP2TR` (SingletonBeacon): `tb1pv20uwrf5ujvlnxu334se3302gvswyaqjztljk36a8j6h0z5xd68s5mdar7`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1qt8q2sn03hnldk228emy7u2jpeamtjkxyvn9wyw`
  - update 2 at `initialP2PKH` (p2pkh, key rotated): `moanHFLffaoSfqWGLrjErv1hZzTSHa9NTj`

### 16-x1-beacon-add-then-use

- **DID:** `did:btcr2:x1qxkut6n0n0gvkf9f6u5ajeyd7twashs5yg8e38cg7eehq2mz48rxcfafsgh`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mzA9nQhWGUxUWgiYN9iB3zPJqrtB1BfMgi`
  - `initialP2WPKH` (SingletonBeacon): `tb1qe3anasgd4selx02qwx25jczeejcxyy08096rkv`
  - `initialP2TR` (SingletonBeacon): `tb1pr0tsugvq7qcxvq48890d6cydlca9f2swplurv3lhmh098utg8puqu9qyv8`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1qe3anasgd4selx02qwx25jczeejcxyy08096rkv`
  - update 2 at `newBeacon` (p2wpkh, key newBeacon): `tb1qapylzc4mp237wtqw8mn5knz6p288ahpjn0cz5d`

### 17-x1-vm-add-rotate-authentication

- **DID:** `did:btcr2:x1qx6ld2rxwml5y4ahpwe9d5nmp7xlw4pauecw6qnp6fvaud3c08avw3yf62d`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mzSreZYxbwB7DpAfXFPS8xyTCkMHoNvPDG`
  - `initialP2WPKH` (SingletonBeacon): `tb1qe7jqx0tdpyffh8l0l777p9hne6w77ghxvn6d47`
  - `initialP2TR` (SingletonBeacon): `tb1pjk9mr9dfqss0qgff8y7duzmptlwds5wl3pf6wdwkzulks7v6ej9qjvmdd6`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1qe7jqx0tdpyffh8l0l777p9hne6w77ghxvn6d47`
  - update 2 at `initialP2WPKH` (p2wpkh, key genesis): `tb1qe7jqx0tdpyffh8l0l777p9hne6w77ghxvn6d47`

### 18-x1-embedded-invocation-key

- **DID:** `did:btcr2:x1q84gyrkggd3759z9syj3aeewk8rdlwsfaa95kf38jv8ej2aylyfjkahta4n`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mtoByNVHu4vVjUAKYYAYtQr39a7KoefLSC`
  - `initialP2WPKH` (SingletonBeacon): `tb1qjx4m25etu4gr40ktl8d5mzcky4kl966afjckwd`
  - `initialP2TR` (SingletonBeacon): `tb1ph82yn359p9d44w0cz5w0detuhvlv7gj0gd9d2hwp8jz3qh3k806sh64582`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1qjx4m25etu4gr40ktl8d5mzcky4kl966afjckwd`

### 19-x1-relative-ids

- **DID:** `did:btcr2:x1q99qwj9umyetasrrcrxj8cuhsjzkj7z6uf0dx3ahtcmq8grx35g8u6fldxr`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `n4JtsgeMjCstaLUcBHLKsnsZZ5U6Kc2mbM`
  - `initialP2WPKH` (SingletonBeacon): `tb1qlgpshed5c9tlwazvaqceaacvcunqcr89w2kd6e`
  - `initialP2TR` (SingletonBeacon): `tb1pzdvxq978c22rwvd8w2ekd62vp6e4zh535rue5gx0ewt2nwyk34css3cw9y`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1qlgpshed5c9tlwazvaqceaacvcunqcr89w2kd6e`

### 20-k1-cas-update

- **DID:** `did:btcr2:k1qypda5tj07vn65yhyly00t8879laup7dgf8nm52mahnax38ke939srs7wthpd`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mnetBqWDpsWdVyW9Kzk5epebyGuJmpDiJS`
  - `initialP2WPKH` (SingletonBeacon): `tb1qfeyv0xyas279aa4tu4jppeaaadukqpm49fsq5x`
  - `initialP2TR` (SingletonBeacon): `tb1p2u9etzhkee6t4c50w6yv2xxat5xrhvryqljq93exsx6fglpy37ws0px2pf`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1qfeyv0xyas279aa4tu4jppeaaadukqpm49fsq5x`

### 21-k1-deactivate-then-update

- **DID:** `did:btcr2:k1qyplj6cu65rh6ejq9ssx86ftjaqf4v0jf25ay59qwmrm92wxhstvy5sw6py47`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `muNouGfvQvDj5JxoTFD73ME6YyQzfMmaGR`
  - `initialP2WPKH` (SingletonBeacon): `tb1qnqrk6erydu0qulwaal823jsfalwps3upuk26n2`
  - `initialP2TR` (SingletonBeacon): `tb1p2p34ff8yj9kzwnghf7uh8z6ngvmtdf3ngcy2c626va0w96hdnx9s44zxxq`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1qnqrk6erydu0qulwaal823jsfalwps3upuk26n2`
  - update 2 at `initialP2WPKH` (p2wpkh, key genesis): `tb1qnqrk6erydu0qulwaal823jsfalwps3upuk26n2`

### 22-x1-three-updates-resolution-options

- **DID:** `did:btcr2:x1q8y5x5f35cw5jc278nqhaqnu8jlza4aa6glszzscp9sgavwkgx596d3vfs2`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mghD7KFrS5PRZuk1CRnPFQeNueMA49puus`
  - `initialP2WPKH` (SingletonBeacon): `tb1qpn52da7ch53kcamqacm97n3h7rtflag7fpmdl9`
  - `initialP2TR` (SingletonBeacon): `tb1pucr3dnq68yfqxlfq8x7gw0epm0w4tm9nvqusrl33e94fakh5jkcqs2pdfk`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1qpn52da7ch53kcamqacm97n3h7rtflag7fpmdl9`
  - update 2 at `initialP2WPKH` (p2wpkh, key genesis): `tb1qpn52da7ch53kcamqacm97n3h7rtflag7fpmdl9`
  - update 3 at `initialP2WPKH` (p2wpkh, key genesis): `tb1qpn52da7ch53kcamqacm97n3h7rtflag7fpmdl9`

### 23-k1-duplicate-signal

- **DID:** `did:btcr2:k1qypjcajtptruvwylxszx20zmgw3350p5vxh360e0hq48v7g539uq5ncr7fm29`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mgQQh2vwWy1ESyaX91o1xFpzeji5seJxqz`
  - `initialP2WPKH` (SingletonBeacon): `tb1qpxanl8t3nkq6ttfpe54eudd06v5660x2ppfdm4`
  - `initialP2TR` (SingletonBeacon): `tb1p3kd2rqyjturcvzkzts2q45w7kwvsgtzhdheqw9v86j9m2am6mm6sceafcn`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1qpxanl8t3nkq6ttfpe54eudd06v5660x2ppfdm4`
  - update 2 at `initialP2WPKH` (p2wpkh, key genesis): `tb1qpxanl8t3nkq6ttfpe54eudd06v5660x2ppfdm4`
  - update 3 at `initialP2WPKH` (p2wpkh, key genesis): `tb1qpxanl8t3nkq6ttfpe54eudd06v5660x2ppfdm4`

### 24-k1-removed-beacon-signal

- **DID:** `did:btcr2:k1qypws7tm5j3hp3tzs093hgjhf3udepew8jk08xkx3hk2hvhdpd70d0qcn6xs7`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mgTxnxShbm8qfQ6C5ybUPZnhehCCfYnUN5`
  - `initialP2WPKH` (SingletonBeacon): `tb1qpfn5kwug6xrh8g8w73js9zj8qm842866suuqd3`
  - `initialP2TR` (SingletonBeacon): `tb1p8xxv62gau2qjtz0ua2nq0944flm9pmlyne8mrk700jvafd2uga4st0qf9l`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1qpfn5kwug6xrh8g8w73js9zj8qm842866suuqd3`
  - update 2 at `initialP2PKH` (p2pkh, key genesis): `mgTxnxShbm8qfQ6C5ybUPZnhehCCfYnUN5`

### 25a-x1-smt-update-no-nonce

- **DID:** `did:btcr2:x1q8wpt5qush3tpm9m4estslk3gs6vqys52mkutzvg3ckwlm66hhakuuvphz2`
- **Cohort:** smt-25
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mnWRc7nQgHFTiQNM1TJ4b1YpPb2REsgqvt`
  - `initialP2WPKH` (SingletonBeacon): `tb1qfjh5x50amys5289p8s3ljef469dgfak62zv0e3`
  - `initialP2TR` (SingletonBeacon): `tb1pdl8udujelv4vvaqz6jeu53499nwe5wyu89c8e7307d2alf00yh8q6k00qg`
  - `cohortBeacon` (SMTBeacon): `tb1q2ksthtw2yx79t7zmmfzq9vghcmmrna385p6cjm`

### 25b-x1-smt-nonce-no-update

- **DID:** `did:btcr2:x1q9pspvd9waez6wddkm39ztwty6ygqup0k0fzd82h0dw89kng4z8s2y46mye`
- **Cohort:** smt-25
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mweQj4u4HngV2hQDYPLrBJfzsCqZP5EAck`
  - `initialP2WPKH` (SingletonBeacon): `tb1qkr40em8hlvktfq4r7vhhtgg4llesxazshn5t7d`
  - `initialP2TR` (SingletonBeacon): `tb1pl3huprqw390ur9uyr33arrw778vddkyzjuxgcft2gnh62cmfnsdsqay6wl`
  - `cohortBeacon` (SMTBeacon): `tb1q2ksthtw2yx79t7zmmfzq9vghcmmrna385p6cjm`

### 25c-x1-smt-empty-index

- **DID:** `did:btcr2:x1qy0glluzajpjwsr0tuthpv7m7k8nru5hck53muaj50wcxwfw03hgxud8pr6`
- **Cohort:** smt-25
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `moZ2L2hAHbd2kxZVaskw66YdDPTEqdy7mq`
  - `initialP2WPKH` (SingletonBeacon): `tb1qtqjnffn0ahfnfr37jl4dsu6vzn0m7ymxquwzk2`
  - `initialP2TR` (SingletonBeacon): `tb1prxuzdqx5h3uux2vtcezfsyhl76senekzt9es5zds8dzgsr7g3daqly7yl7`
  - `cohortBeacon` (SMTBeacon): `tb1q2ksthtw2yx79t7zmmfzq9vghcmmrna385p6cjm`

### 26-k1-signal-below-current-height

- **DID:** `did:btcr2:k1qyphftn050vfx0xy55ch6w9etarzwt6dtetdrcwgvv6hykvfxqsjw5cztmh8a`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mhKNF8bpN1T1jUizZfmt2mbhdos2wcPj1Z`
  - `initialP2WPKH` (SingletonBeacon): `tb1qzwl5prvn8fy4lhx49wencv74wq47gtmfq4aaqc`
  - `initialP2TR` (SingletonBeacon): `tb1pafaphhd3q6ac0fzhhd7gpz5su86jy6j0v4zarqk3ft8dxfwczm6q6ng858`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1qzwl5prvn8fy4lhx49wencv74wq47gtmfq4aaqc`
  - update 2 at `lateBeacon` (p2wpkh, key lateBeacon): `tb1qh334pkj6hc7d76d8rqvhqph9h9zhzctdc7lsc7`

### n01-k1-invalid-did-checksum

- **DID:** `did:btcr2:k1qyps5h33rz9gz65cqj7rr2clssp64wrleuyjw5p664dmasdttg6gc7ss6fzz9`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mqFz9UtG7ZPA6meWTxY7V9L52vdZdKtxQs`
  - `initialP2WPKH` (SingletonBeacon): `tb1qdtwfppj8fxu5nqmgcfkjxxyhlpdkfqtyw3lfjl`
  - `initialP2TR` (SingletonBeacon): `tb1p7qs9e30pc2t0gcvyhq4dkdcmcvrmnmwuuunaqnt7amfdhzcvlyrsuj2453`

### n02-x1-invalid-did-padding

- **DID:** `did:btcr2:x1q9k9vxhx2p8pskyz8kksszd9u8y5j8qclzhhvewuqw2uvwl6ewqa6dwudxq`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `n1BvmxhQfENYYErFghWkLJptzMoP2TTjbn`
  - `initialP2WPKH` (SingletonBeacon): `tb1q6ly4svm398fn30px4ldhs0xdejv3nepwk3gjaw`
  - `initialP2TR` (SingletonBeacon): `tb1pmklc3s2dtqm62z58rjv4kmp2cvdp06l98mw44qu0fmtpndmhhqrqutdvm4`

### n03-k1-invalid-did-network-nibble

- **DID:** `did:btcr2:k1qypszaexycatrzkcclaxcwqsm03382c4m837g6eq3afzfg85fyym8qqga4wng`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mw5RcFbiVJRsJCThsT7p6ZgT3EPCuiFv5s`
  - `initialP2WPKH` (SingletonBeacon): `tb1q42kl7auksggwuw5wxnd4d23stl339wwwr8czsv`
  - `initialP2TR` (SingletonBeacon): `tb1pnhkukcws4v042q764appwpgrlj32sjlcx5tawgtfk6alky455s6qrxg7eg`

### n04-x1-genesis-hash-mismatch

- **DID:** `did:btcr2:x1q9nuqr6s45cefydrefvujcy6sj4d6frc5gyuxzmn07xe2au50u39zm4lvzg`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `moU2TztgzVZzZ29EZ7Kf2Nos1ZTtJkjSLx`
  - `initialP2WPKH` (SingletonBeacon): `tb1q2uenm9yfjn86fg74prkm6t8h29azpawvgrtv26`
  - `initialP2TR` (SingletonBeacon): `tb1pjp2vv7yd04utc5lz0sjcjn6mvz5wpj3e59jc2mnecjupmpd7dvfqpww3a2`

### n05-x1-missing-update-data

- **DID:** `did:btcr2:x1qyzmtprn8rzs07nlfg0ex82n5fcpqcrjr304ysdxj5crdvsk04gpgjtk49x`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mw9zEKnn7LkEb1mTTWag311NUM2b9p9YEP`
  - `initialP2WPKH` (SingletonBeacon): `tb1q4w9wff7k2daczf2jj7uch49hyuq9g85a6k7ne2`
  - `initialP2TR` (SingletonBeacon): `tb1pwukk9u89ym8h5lvumrxdvd6c7m3nkky95d4g3zl8s09w44225r4qpp9qku`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1q4w9wff7k2daczf2jj7uch49hyuq9g85a6k7ne2`

### n10-k1-invalid-update-context-member

- **DID:** `did:btcr2:k1qyp527drq8afc6jffc9ndmzvzw90kendr58p2ggjep4xsk8y5tg0yxq0gpzm9`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mvEzG4SHbM54RdpKFqCvthh9Yvf7X9Zn72`
  - `initialP2WPKH` (SingletonBeacon): `tb1q5xzd73ukge7v9dzyj7qjcwygxzh3083mshjlr2`
  - `initialP2TR` (SingletonBeacon): `tb1p6d6mguyy5re9mgdmcd7m20t2uuzgcdvnd5vnz4s8aacsaq0vnr8skz9zcc`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1q5xzd73ukge7v9dzyj7qjcwygxzh3083mshjlr2`

### n11-k1-invalid-update-context-order

- **DID:** `did:btcr2:k1qyp2ju952zdgpe305hghjcs6l4ypdg9zrzhtuxuqcqa2hq8wgcxlmscd86x37`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `miZTxteL3xe1V5Fi8HX53PhrCJ1FJk6o7i`
  - `initialP2WPKH` (SingletonBeacon): `tb1qy9sln62ze0gffvsda0xxe9a7fakqx5jqs2sjyt`
  - `initialP2TR` (SingletonBeacon): `tb1p5zlc6gdzkps4qa4effyntmqjjel2rtqxz7ksnmjutdlfz3e5w4nqxerapy`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1qy9sln62ze0gffvsda0xxe9a7fakqx5jqs2sjyt`

### n12-k1-invalid-update-proof-context

- **DID:** `did:btcr2:k1qypc0v9c9ykelxpensp3fcsmwzvemsteqkmcccnhk73t4fjxxrt4u9s6e9s6g`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mpaui2ziEeg2BD8EJhZxi2b8VPAqXobrHy`
  - `initialP2WPKH` (SingletonBeacon): `tb1qvdu2xquewfuuqur72g9la7kcjryxy4cf4ymrxd`
  - `initialP2TR` (SingletonBeacon): `tb1pmuzaeu4j4th0j242e5ajwyw3xeldsukug7xe3k300ldhf4kpuwxsrp6660`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1qvdu2xquewfuuqur72g9la7kcjryxy4cf4ymrxd`

### n13-k1-invalid-update-capability-action

- **DID:** `did:btcr2:k1qyphxahcy9w386x0erjpmtwjw7y6vgd7aexcmdjxecdjzkf3wyzlrjckwcvlk`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `n3J5Fg7aZ4jMwJNYR3QP6RdPJ8xJZndVgs`
  - `initialP2WPKH` (SingletonBeacon): `tb1qam3jkdcgd6gqpr2q5k20vtp0nx3jk4wnnh742x`
  - `initialP2TR` (SingletonBeacon): `tb1pd27n43vfeuj6cd5nxw9dajnpzfnj0gsktx56ldep9g35n34lk2eqghy44x`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1qam3jkdcgd6gqpr2q5k20vtp0nx3jk4wnnh742x`

### n14-k1-invalid-update-capability-encoding

- **DID:** `did:btcr2:k1qypkdal6kw7tpky2t5ph0wsf5v2v5svzn5s2nktqk376rx2nwt3kyxsx489kf`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mpD6XVhv398iaajhee2cFt9i4J9Vdnbt5r`
  - `initialP2WPKH` (SingletonBeacon): `tb1qtavgg2wu42d9l8jae6dz5yccds86ntj5s77rcx`
  - `initialP2TR` (SingletonBeacon): `tb1pyzgnt8l0vpe8kvv8qwrlgjfmquztu8mcg0xwfzzs0r3n0lzwjyxq8mfrqx`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1qtavgg2wu42d9l8jae6dz5yccds86ntj5s77rcx`

### n15-k1-invalid-update-proof-purpose

- **DID:** `did:btcr2:k1qyp7s8n52kmzdjef24pnq6m6q5qhpks2ls9dp3p4pd8v32fy9xalyvge8hqgw`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mjuersDQ7xYJuU48zXVZUHEH35ygTrpNyZ`
  - `initialP2WPKH` (SingletonBeacon): `tb1qxq4cg5fv894jh9rl2amyyh70rg7llljyxw59hm`
  - `initialP2TR` (SingletonBeacon): `tb1pcuupqu782l320zw0tu4x3wsv9t7jd0hz804l3hcup0gy73zymrtslfdgc4`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1qxq4cg5fv894jh9rl2amyyh70rg7llljyxw59hm`

### n16-x1-invalid-update-unauthorized-method

- **DID:** `did:btcr2:x1q9rxnv9723u4c4w8rmhad04at9ypde99q5j2t3l66rqj5784avuawmljxvf`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `n496gBSCzy8fsJKuaHEohHBSYWxEWBBufP`
  - `initialP2WPKH` (SingletonBeacon): `tb1qlq5t6ph065eqxmtqvu38zvw7qt7dhllt2e7nsr`
  - `initialP2TR` (SingletonBeacon): `tb1pw9r20mwu3fl0zq9wses7sra03y3s484c7kh8aa9xnm9ckwnx2m8su9pgz7`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1qlq5t6ph065eqxmtqvu38zvw7qt7dhllt2e7nsr`

### n17-k1-invalid-update-unknown-method

- **DID:** `did:btcr2:k1qype9x7f2tfqs8p6m3t2s25h5cdmquaezn4p97tjacxspuc4p2ag53chrsv2v`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `n3pjWkgwUsgSsMK27HbLvbL3H2DkwrsJen`
  - `initialP2WPKH` (SingletonBeacon): `tb1q7jhetcnyry4j74q4tyfy2x8r8wvzzhsecmq7a7`
  - `initialP2TR` (SingletonBeacon): `tb1px7fx2j4hvdp2vegxyfjfzqzxwznndx289w52g4kj833rwku6mkzqpvx940`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1q7jhetcnyry4j74q4tyfy2x8r8wvzzhsecmq7a7`

### n18-k1-invalid-update-proof-value

- **DID:** `did:btcr2:k1qypdef8c9lgmfudfrzckpw863jjrvh4ygp6y99yzmqezwapk8reyuyqxkxr4j`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `miSC94u7C9MRtJYmfbpDKPLtppYB7w219q`
  - `initialP2WPKH` (SingletonBeacon): `tb1qyqqa44wqr9sfk4etc2sw9mypr68tnvhkj7wy4e`
  - `initialP2TR` (SingletonBeacon): `tb1pkjdp8md3kmlke05y2593rwq2gzvs94k344uel7espz5a0kna8s3qpess4m`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1qyqqa44wqr9sfk4etc2sw9mypr68tnvhkj7wy4e`

### n19-k1-invalid-update-source-hash

- **DID:** `did:btcr2:k1qyp3yvm36yddzkstdnlphxc3n5lvle7wsy3dnhqzgycfpnfarhcgxdsgvdv82`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mu6qQ3adaiCV8YWBtsfPkS8QTA2EcDnTTo`
  - `initialP2WPKH` (SingletonBeacon): `tb1qj5pq25l76sc2y6taqs82ellcs02jruq2qecqgv`
  - `initialP2TR` (SingletonBeacon): `tb1pht4cqvtss3268rdh2zty9fmlamz3df3pjjx3qrgammyh46rzq3rq9hfd3e`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1qj5pq25l76sc2y6taqs82ellcs02jruq2qecqgv`

### n20-k1-invalid-update-target-hash

- **DID:** `did:btcr2:k1qypp2qvacsjzfuww3vxn25t0fnuf6z9zxuyhax5eaehytg9tstrgzkcc7mkp8`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mnYpBukKEjX1NpWpHNbL4WR9zSMitBjQy5`
  - `initialP2WPKH` (SingletonBeacon): `tb1qf530yfl73j5xayufz6zcga90l67r0trdz68xv2`
  - `initialP2TR` (SingletonBeacon): `tb1py0xn0ujwtp9vcxq7nkqkha6h2y5mmnaz66d9dc5pjzrv66zgadgsza6jgp`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1qf530yfl73j5xayufz6zcga90l67r0trdz68xv2`

### n21-k1-invalid-update-version-skip

- **DID:** `did:btcr2:k1qyp0nl7q0y52mqmrlej7ghla2t5t3dqgngrphy70y5fa96ep3mywm5su2xxf9`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mqay93L2Ut1F3iPt3R9kg1UTFrFKcX6Yq5`
  - `initialP2WPKH` (SingletonBeacon): `tb1qdee6qu8j0qldthz8h3x3n2awxa5ve997tyt52k`
  - `initialP2TR` (SingletonBeacon): `tb1p76etdqtn9ja9rz83ksw4kdddpqx8lxjsq3nax5jp7x8uemulre3sjlqr4l`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1qdee6qu8j0qldthz8h3x3n2awxa5ve997tyt52k`

### n22-k1-invalid-update-patch-missing-path

- **DID:** `did:btcr2:k1qypljzfnqdv343t0zufeyfphpumav2tmxvzu87pm5jca4ly00gs0n4g0tsvq4`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `moiDcE145ApDoL4kzQpaQZXzM9vhQrvEph`
  - `initialP2WPKH` (SingletonBeacon): `tb1qt8396h7r79c2lmj226h44huhxe6tyd0mjavhr5`
  - `initialP2TR` (SingletonBeacon): `tb1pudmhrsqjkm7ywzgzjm66cknxek4j5sfju8prjfyc9mfajhct2kfqrwgkjn`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1qt8396h7r79c2lmj226h44huhxe6tyd0mjavhr5`

### n23-k1-invalid-update-patch-changes-id

- **DID:** `did:btcr2:k1qypcaw4m3qwwhah2s4k6yg89efxtk70fx3sg22ccyfphzedktvc4usqa6ldfk`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mwCNmXcQLYkzsU5DoM9Hb8gFFTRga77T4d`
  - `initialP2WPKH` (SingletonBeacon): `tb1q40lgnapgntu80k8cjwjmq043fmept3tv8wcuye`
  - `initialP2TR` (SingletonBeacon): `tb1pv90a0qfh27umdm004qkr5pq605qmw6f38qtlcxmu64d7j8pxgcksn7nza7`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1q40lgnapgntu80k8cjwjmq043fmept3tv8wcuye`

### n24-k1-invalid-update-patch-invalid-document

- **DID:** `did:btcr2:k1qypxr0l9lwdndqwx8ymdrzkze7c7rkjseedxmk4kqks4jnu3t3cdyhc8dhpf8`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mgvDdUZ4HjovJ87f46HA48v8h1e4EXJnaD`
  - `initialP2WPKH` (SingletonBeacon): `tb1qpa08u6dmew4dmfp3ct36a24dm2wszf2r6gvxam`
  - `initialP2TR` (SingletonBeacon): `tb1p38xx6nztyh9rnkrlsmlamduyvxpfpq065v4v5gt8kr6qqlacv6gsj6fl9n`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1qpa08u6dmew4dmfp3ct36a24dm2wszf2r6gvxam`

### n25-k1-invalid-update-created-after-block

- **DID:** `did:btcr2:k1qyph2fjvxy9gddagyxsketux0wzqje3hquhzqfcpzua8dw4gqkjq6msh7a6ea`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `myy8oAwodjdhCeE5CLNWSTqADBL2pT1c1r`
  - `initialP2WPKH` (SingletonBeacon): `tb1qefja3p9cvlflvgtw7j7skfzg5dzr3h7jza9t3k`
  - `initialP2TR` (SingletonBeacon): `tb1ppl67493uhcthnh4p4aj5q9ra5zyeafa28t7d2npwtzd0wzamcwqsrsmm06`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1qefja3p9cvlflvgtw7j7skfzg5dzr3h7jza9t3k`

### n26-k1-invalid-update-expires-before-mediantime

- **DID:** `did:btcr2:k1qypxn45qnzrkt5rmx9wvupy2p4n3g86vt2ps68qvjc7xxjz8j9gw22g069shp`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mn1FrF1Ztf1zj7N7iaUsD7xDgLpddDKhxP`
  - `initialP2WPKH` (SingletonBeacon): `tb1qgu4su3lvz0ckyj2j8w3p0cpfam8gwyq6ckslm9`
  - `initialP2TR` (SingletonBeacon): `tb1pd4tgana2xruwmlpx5u07qvmzgajdahh8qg6eqm8tm65g73kwzkeqv40qtr`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1qgu4su3lvz0ckyj2j8w3p0cpfam8gwyq6ckslm9`

### n27-k1-invalid-update-expires-before-created

- **DID:** `did:btcr2:k1qypyl83sytn85uk5544vchxg547fyadsp82cg42psuxg8wr2j65rycqc58eua`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mqCQgUXv3kB76YSkg1UrHMPVi2x8fUUVan`
  - `initialP2WPKH` (SingletonBeacon): `tb1qdghkrpectn5valv7p3dzgknz48whgg20seelux`
  - `initialP2TR` (SingletonBeacon): `tb1p7y4hmalzsxglpqq5gac44gtsd7a6w28ednhe27enelq888esajnsz9jf40`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1qdghkrpectn5valv7p3dzgknz48whgg20seelux`

### n28-k1-late-publishing

- **DID:** `did:btcr2:k1qypv877ay48akw53pc2kk3p6rv9l9rsd4pyj6fxfzmufa8t03lnm5dcykxjxs`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mn3d7AP5t8nfF2so3NW5XHAbidxgxeZTjG`
  - `initialP2WPKH` (SingletonBeacon): `tb1qg7w6rc5xgxm97l2ef2x5xz99lkv6x9y0fc0gkg`
  - `initialP2TR` (SingletonBeacon): `tb1p0eu2qa6s3dx3rm3n4cz28hjutuy0czry4uftvnr9lrzs8qk6rzgqxe8m8l`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1qg7w6rc5xgxm97l2ef2x5xz99lkv6x9y0fc0gkg`
  - update 2 at `initialP2PKH` (p2pkh, key genesis): `mn3d7AP5t8nfF2so3NW5XHAbidxgxeZTjG`

### n29-x1-smt-proof-hash

- **DID:** `did:btcr2:x1qxrwycarfgnplgal08kk479vfs4t3cx5wmxkcjfqxqp2amh8f5xe7vd7npp`
- **Cohort:** smt-25
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mp2v2YjhrctMFLumXK7ZfHDga8zKhJgF49`
  - `initialP2WPKH` (SingletonBeacon): `tb1qt44e02smy4yvs89l2nxwvlrxwlwqd9ytcl0fwt`
  - `initialP2TR` (SingletonBeacon): `tb1p9nfrzc0l7ac5xrj79v7ycm75mzyj90hr32ejdwxqwa9nvadr0nlqg3w9pz`
  - `cohortBeacon` (SMTBeacon): `tb1q2ksthtw2yx79t7zmmfzq9vghcmmrna385p6cjm`

### n30-x1-smt-proof-root-id

- **DID:** `did:btcr2:x1qyuvshka7ay69lj9ex2gcvyjupy7g7mc9gh03q9rx2lalgm9wpdt68cy7f5`
- **Cohort:** smt-25
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `n4qoyj5hMqpys2R18TWEYoKyggEZ8mAkys`
  - `initialP2WPKH` (SingletonBeacon): `tb1qllda40wftpcq4fgk2wa7curdpwnqkjf2ldk69p`
  - `initialP2TR` (SingletonBeacon): `tb1pvz9dl70v4thyxavgdnd5m8hk8l3r69940m2m34fg5jet94a89a8spnad2u`
  - `cohortBeacon` (SMTBeacon): `tb1q2ksthtw2yx79t7zmmfzq9vghcmmrna385p6cjm`

### n31-x1-smt-proof-withheld

- **DID:** `did:btcr2:x1qxvg5h46yn29wgx6dmzzfswwtlccwpdtkg524sp507c5dgzce2525cxed4h`
- **Cohort:** smt-25
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mnZSzL7jPgMv1jFpFsLk49zNiurUvttr3S`
  - `initialP2WPKH` (SingletonBeacon): `tb1qf4q655tuupn25ctl8vrm62jq2ukpr5xjsym05m`
  - `initialP2TR` (SingletonBeacon): `tb1ppgqnmaklet8cf6v8x5cu5l5wwukgwyu20n6pzyq7a8zf3dmpxfys2ewlz4`
  - `cohortBeacon` (SMTBeacon): `tb1q2ksthtw2yx79t7zmmfzq9vghcmmrna385p6cjm`

