# Test Vector Funding Targets (mutinynet)

Generated from 59 scenarios: 38 anchor their own beacons, 12 are cohort members (one shared anchor per cohort), 9 need no funding.

## Solo beacon addresses

Each address carries one OP_RETURN per anchor. Fund each address once; the anchor step chains the change.

| Address | Type | Anchors | Scenarios |
|---------|------|---------|-----------|
| `mtcqJbbGTHLCKiBzy9NWE2vudFrYkw13rr` | p2pkh | 1 | 02-k1-sidecar-update |
| `mzazbmrrCZZbySUEv7fRWGMMUMfEGbe6H9` | p2pkh | 1 | 04-x1-sidecar-update |
| `tb1qac7m7sw4wwgnn9xcuntwyg8m5vl3t3pmwnkme6` | p2wpkh | 3 | 06-x1-cas-3-updates |
| `mwmT5k7vJGmAxnZakfyzGKTLEHGDufXDCf` | p2pkh | 1 | 07-k1-sidecar-deactivate |
| `tb1qw73yrjwqc3wlwz2jv6q743qjyw2hkq5ld3nm5r` | p2wpkh | 2 | 08-x1-cas-update-deactivate |
| `tb1qag8lg2mswazfmgfr4wdexx3ra0s9lu0rcnzd9j` | p2wpkh | 1 | 13-k1-update-p2wpkh |
| `tb1pg9z4mrrh3ljlagqlupekl4lkztsgr5jdwflj8ja5krj06yhn50hswxde24` | p2tr | 1 | 14-k1-update-p2tr |
| `tb1q54xkj3kklclpmah6p6tpxqctm7nhlnsu5uj94f` | p2wpkh | 1 | 15-x1-beacon-rotation |
| `mrtQKFuBcCAPsHcrGHSqbTbXNQQ63iyt8V` | p2pkh | 1 | 15-x1-beacon-rotation |
| `tb1qtuupqswftvyat3yu8advx53d67wp26ce8h7s6t` | p2wpkh | 1 | 16-x1-beacon-add-then-use |
| `tb1qpugdfd6hj42vqy8w43uweg4pcw73va4he6cdrc` | p2wpkh | 1 | 16-x1-beacon-add-then-use |
| `tb1q7fwgmxypm9pl5st9h544xxvgf23gshqqza3sva` | p2wpkh | 2 | 17-x1-vm-add-rotate-authentication |
| `tb1q92jlvspjmlrrgk2jd52stcwpzepvk2f5aes05s` | p2wpkh | 1 | 18-x1-embedded-invocation-key |
| `tb1qflfgvgppj0k0m7d4vrfc4kszmettjxusp8gqsw` | p2wpkh | 1 | 19-x1-relative-ids |
| `tb1qwzspueme8rkxuaqf6s7g2y5mvzdah9gjgyt276` | p2wpkh | 1 | 20-k1-cas-update |
| `tb1q8kq7fmsa2lfhqfpz42vqe8fj4qf4y9qzzzpw5z` | p2wpkh | 2 | 21-k1-deactivate-then-update |
| `tb1qu63k5rlsrhmh8fsnw6v0uwmlknp5k476t6eahf` | p2wpkh | 3 | 22-x1-three-updates-resolution-options |
| `tb1qs3mrnx0t2gk4006qvfppg50ahryrvzzgwx9sg0` | p2wpkh | 3 | 23-k1-duplicate-signal |
| `tb1qsfyw0hs8mcl66gcscar3tgk6vdah3r39qf79q6` | p2wpkh | 1 | 24-k1-removed-beacon-signal |
| `msPqUa5A3Y75gzESB6qeLrVSgnggT9KNr7` | p2pkh | 1 | 24-k1-removed-beacon-signal |
| `tb1qz2kuac6p7n33edy7mynac964zezvfl500ly5mn` | p2wpkh | 1 | 26-k1-signal-below-current-height |
| `tb1qzjpgtampg3s564x2afp3g9e5mycvfla7zmc765` | p2wpkh | 1 | 26-k1-signal-below-current-height |
| `tb1q68rcfej994krjanvqzmgmm76vy8rggaa9nl35f` | p2wpkh | 1 | n05-x1-missing-update-data |
| `tb1q0s8rlcp04vhuww5s696ywllqp82cjhzfn6ceuh` | p2wpkh | 1 | n10-k1-invalid-update-context-member |
| `tb1qdrjv5p5fa4an9axhnmavgy3cs6elufwrnc8gnw` | p2wpkh | 1 | n11-k1-invalid-update-context-order |
| `tb1q2mwzuaupg2a307ycss26eng0rpn92rrge4l4pe` | p2wpkh | 1 | n12-k1-invalid-update-proof-context |
| `tb1qt5jyq3frf2072gg3wa90wa62larpey7addca04` | p2wpkh | 1 | n13-k1-invalid-update-capability-action |
| `tb1qppxf8fm730z0p8gg6ethzxamdn0avadh8mx5n6` | p2wpkh | 1 | n14-k1-invalid-update-capability-encoding |
| `tb1q7klr3kpw7asytqlx8l09k66u6p6gtp4p4sfvct` | p2wpkh | 1 | n15-k1-invalid-update-proof-purpose |
| `tb1qqwpm8ltdcc08fmm2daahl6x0mnc380enwzml3z` | p2wpkh | 1 | n16-x1-invalid-update-unauthorized-method |
| `tb1qw7pasm2df0nzen33d7gct2m4dsks4rddup3v3d` | p2wpkh | 1 | n17-k1-invalid-update-unknown-method |
| `tb1qn962kknqzm5eyyv5z908jgeqe2q9pg4k5chqly` | p2wpkh | 1 | n18-k1-invalid-update-proof-value |
| `tb1qd3y483tefn7usksg0g44q29q5hc64zjf3c0qzg` | p2wpkh | 1 | n19-k1-invalid-update-source-hash |
| `tb1qgn28n3s03ccnagc35a7rdfdvv6y490zs4nejjz` | p2wpkh | 1 | n20-k1-invalid-update-target-hash |
| `tb1qp3y9vupt00x2thurc9zpc96emjlwxt5vfgx6kl` | p2wpkh | 1 | n21-k1-invalid-update-version-skip |
| `tb1qgeknafncfnt7p6ayu27xw50j4hj5xlxycdl6j7` | p2wpkh | 1 | n22-k1-invalid-update-patch-missing-path |
| `tb1q7djmnty9udwjgwqwtensnkkn6r6trxwu39kuux` | p2wpkh | 1 | n23-k1-invalid-update-patch-changes-id |
| `tb1qftvwsksaayy4a3q8a872jyzxdhm9qj0228vvwx` | p2wpkh | 1 | n24-k1-invalid-update-patch-invalid-document |
| `tb1qkspe0djjh9s26xdq6y32l8ft73hlfr0astagks` | p2wpkh | 1 | n25-k1-invalid-update-created-after-block |
| `tb1q4heppnstds8gy8k7zw2k5pnvaykt9qgmy8s0j4` | p2wpkh | 1 | n26-k1-invalid-update-expires-before-mediantime |
| `tb1qs7fe2ly4ase7pnlsdhgnnxcrznyekr6uryqhtd` | p2wpkh | 1 | n27-k1-invalid-update-expires-before-created |
| `tb1qan6cw0ectkvq3ytswrzywymqy5wwngwlzt6cmt` | p2wpkh | 1 | n28-k1-late-publishing |
| `n37stw1K3MQsf8Re14nyCyiEVzRRshDya8` | p2pkh | 1 | n28-k1-late-publishing |

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
mtcqJbbGTHLCKiBzy9NWE2vudFrYkw13rr
mzazbmrrCZZbySUEv7fRWGMMUMfEGbe6H9
tb1qac7m7sw4wwgnn9xcuntwyg8m5vl3t3pmwnkme6
mwmT5k7vJGmAxnZakfyzGKTLEHGDufXDCf
tb1qw73yrjwqc3wlwz2jv6q743qjyw2hkq5ld3nm5r
tb1qag8lg2mswazfmgfr4wdexx3ra0s9lu0rcnzd9j
tb1pg9z4mrrh3ljlagqlupekl4lkztsgr5jdwflj8ja5krj06yhn50hswxde24
tb1q54xkj3kklclpmah6p6tpxqctm7nhlnsu5uj94f
mrtQKFuBcCAPsHcrGHSqbTbXNQQ63iyt8V
tb1qtuupqswftvyat3yu8advx53d67wp26ce8h7s6t
tb1qpugdfd6hj42vqy8w43uweg4pcw73va4he6cdrc
tb1q7fwgmxypm9pl5st9h544xxvgf23gshqqza3sva
tb1q92jlvspjmlrrgk2jd52stcwpzepvk2f5aes05s
tb1qflfgvgppj0k0m7d4vrfc4kszmettjxusp8gqsw
tb1qwzspueme8rkxuaqf6s7g2y5mvzdah9gjgyt276
tb1q8kq7fmsa2lfhqfpz42vqe8fj4qf4y9qzzzpw5z
tb1qu63k5rlsrhmh8fsnw6v0uwmlknp5k476t6eahf
tb1qs3mrnx0t2gk4006qvfppg50ahryrvzzgwx9sg0
tb1qsfyw0hs8mcl66gcscar3tgk6vdah3r39qf79q6
msPqUa5A3Y75gzESB6qeLrVSgnggT9KNr7
tb1qz2kuac6p7n33edy7mynac964zezvfl500ly5mn
tb1qzjpgtampg3s564x2afp3g9e5mycvfla7zmc765
tb1q68rcfej994krjanvqzmgmm76vy8rggaa9nl35f
tb1q0s8rlcp04vhuww5s696ywllqp82cjhzfn6ceuh
tb1qdrjv5p5fa4an9axhnmavgy3cs6elufwrnc8gnw
tb1q2mwzuaupg2a307ycss26eng0rpn92rrge4l4pe
tb1qt5jyq3frf2072gg3wa90wa62larpey7addca04
tb1qppxf8fm730z0p8gg6ethzxamdn0avadh8mx5n6
tb1q7klr3kpw7asytqlx8l09k66u6p6gtp4p4sfvct
tb1qqwpm8ltdcc08fmm2daahl6x0mnc380enwzml3z
tb1qw7pasm2df0nzen33d7gct2m4dsks4rddup3v3d
tb1qn962kknqzm5eyyv5z908jgeqe2q9pg4k5chqly
tb1qd3y483tefn7usksg0g44q29q5hc64zjf3c0qzg
tb1qgn28n3s03ccnagc35a7rdfdvv6y490zs4nejjz
tb1qp3y9vupt00x2thurc9zpc96emjlwxt5vfgx6kl
tb1qgeknafncfnt7p6ayu27xw50j4hj5xlxycdl6j7
tb1q7djmnty9udwjgwqwtensnkkn6r6trxwu39kuux
tb1qftvwsksaayy4a3q8a872jyzxdhm9qj0228vvwx
tb1qkspe0djjh9s26xdq6y32l8ft73hlfr0astagks
tb1q4heppnstds8gy8k7zw2k5pnvaykt9qgmy8s0j4
tb1qs7fe2ly4ase7pnlsdhgnnxcrznyekr6uryqhtd
tb1qan6cw0ectkvq3ytswrzywymqy5wwngwlzt6cmt
n37stw1K3MQsf8Re14nyCyiEVzRRshDya8
```

## All beacon addresses per scenario

### 01-k1-base

- **DID:** `did:btcr2:k1q5pp6jm68c6nd0kjd2vpnyq78tw0nyz65ae925zvjun587dpemghe4shg7ra5`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mywfUkBj5JcQ6iigZPgqjFoHvFLdGa4gKa`
  - `initialP2WPKH` (SingletonBeacon): `tb1qeg02qjk0n0tet0ygqcx5vw0fmwe7dkqjlnyhw4`
  - `initialP2TR` (SingletonBeacon): `tb1ptseu6flfjh8evzr8mhhk9ks7yc40cvvt58zwq635sac0yq6lcxfqpjede5`

### 02-k1-sidecar-update

- **DID:** `did:btcr2:k1q5pqhkks8486gcw8fv4aj2wmmxzw252ys6csmzmtxr86tr8uljl60ps5yth0w`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mtcqJbbGTHLCKiBzy9NWE2vudFrYkw13rr`
  - `initialP2WPKH` (SingletonBeacon): `tb1q37myhfqtk624evw8f5m36d9lajzlfpdwtne5sy`
  - `initialP2TR` (SingletonBeacon): `tb1plcwrcfwdnj5zuzm7yn4uclms4wnsm9m5f2yyluj70nksfxd2532qqpjvdw`
- Anchors:
  - update 1 at `initialP2PKH` (p2pkh, key genesis): `mtcqJbbGTHLCKiBzy9NWE2vudFrYkw13rr`

### 03-x1-base

- **DID:** `did:btcr2:x1q498tj8rxtga9gjh2huwejt0w4ag4wauvjx2u93u5s2r6vhatvmw7gqjqzx`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `n3heFUc2MqZHt15jfBg2PoxcvF9aVtB3vH`
  - `initialP2WPKH` (SingletonBeacon): `tb1q7dvy0vaar5n66yjuy0gjl26q8lfdsms9xe7xzd`
  - `initialP2TR` (SingletonBeacon): `tb1pz2zjuy8rtjec07xmr7vkfpr46km73u5fuyglcpafdazysyk0cerqjaqaxy`

### 04-x1-sidecar-update

- **DID:** `did:btcr2:x1q4typvtplw0u68kwsk0ny258u6q5acx5453va5yddkps6l085c0nzwmpsvr`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mzazbmrrCZZbySUEv7fRWGMMUMfEGbe6H9`
  - `initialP2WPKH` (SingletonBeacon): `tb1q6ykl5u22dlkuat0hre28zm63c2h0eklpnh55gv`
  - `initialP2TR` (SingletonBeacon): `tb1pwx9e9rfrfnyrsd5p8fzx9t42m4q8hh9qvp0l6f55z7ayh8tdh2qs5jam2a`
- Anchors:
  - update 1 at `initialP2PKH` (p2pkh, key genesis): `mzazbmrrCZZbySUEv7fRWGMMUMfEGbe6H9`

### 05-x1-no-beacon

- **DID:** `did:btcr2:x1q5rlsadqkdafrsmpp67y5uvpw277ydjj4sujj8g2489m7dp3n7y0s2nwxlz`
- _(no beacon services in this DID document)_

### 06-x1-cas-3-updates

- **DID:** `did:btcr2:x1q5mp6cxq4avt6mapnutxyelfuvyg2gxt46hxpkfq236kxskp9ss7c3sz6gg`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `n3Ef5yQK6WQKvqY5tchnqHYqg6Hpqbn12F`
  - `initialP2WPKH` (SingletonBeacon): `tb1qac7m7sw4wwgnn9xcuntwyg8m5vl3t3pmwnkme6`
  - `initialP2TR` (SingletonBeacon): `tb1p47j2ttenzgfpkfmykqxep2hnr0nv5t0dn6x8cu4e0qv9xp7tsd8q3adn7k`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1qac7m7sw4wwgnn9xcuntwyg8m5vl3t3pmwnkme6`
  - update 2 at `initialP2WPKH` (p2wpkh, key genesis): `tb1qac7m7sw4wwgnn9xcuntwyg8m5vl3t3pmwnkme6`
  - update 3 at `initialP2WPKH` (p2wpkh, key genesis): `tb1qac7m7sw4wwgnn9xcuntwyg8m5vl3t3pmwnkme6`

### 07-k1-sidecar-deactivate

- **DID:** `did:btcr2:k1q5p9uafdl72pvc4nhl8em9z0ydslj7grz8cqyswt99c2nvxsrjrnhngftmpun`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mwmT5k7vJGmAxnZakfyzGKTLEHGDufXDCf`
  - `initialP2WPKH` (SingletonBeacon): `tb1qkglamelz5mt7yt7zf8pw8x0f7ceghkhjpu9gfl`
  - `initialP2TR` (SingletonBeacon): `tb1p5q7xywn8c9d4tymyx9st4mtnasxh4xf90l6cladzlz3upn0mandqwqcct8`
- Anchors:
  - update 1 at `initialP2PKH` (p2pkh, key genesis): `mwmT5k7vJGmAxnZakfyzGKTLEHGDufXDCf`

### 08-x1-cas-update-deactivate

- **DID:** `did:btcr2:x1q5k5xn0ztf2q3vw5qs7cj4jv9g5rd774rjywh8955u074epaeaatw6agr8j`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mrRX5hFWZbyfJYZZQD6XU3cQQ38syyvRKH`
  - `initialP2WPKH` (SingletonBeacon): `tb1qw73yrjwqc3wlwz2jv6q743qjyw2hkq5ld3nm5r`
  - `initialP2TR` (SingletonBeacon): `tb1pk8xs829zqhmcqs2a5776698vhp9ug4elx9umaamsth8l0ahp7j3smkvp0f`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1qw73yrjwqc3wlwz2jv6q743qjyw2hkq5ld3nm5r`
  - update 2 at `initialP2WPKH` (p2wpkh, key genesis): `tb1qw73yrjwqc3wlwz2jv6q743qjyw2hkq5ld3nm5r`

### 09a-x1-cas-update-announcement

- **DID:** `did:btcr2:x1q5kssq8u30w5eual99ss69cknd0y2qesdeythl5tgackgy87nulzq0l5lh4`
- **Cohort:** cas-09
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mkebZ374jBfTwnRoTKUGAuF9MAKx5RQUvY`
  - `initialP2WPKH` (SingletonBeacon): `tb1q8p92guzxtlmwmykr0kvygw46q5vnhnrr4hx5h8`
  - `initialP2TR` (SingletonBeacon): `tb1p4cf84nf2e5he3ece220wafrgr0ym2zv4axvg3gylkcj5e4g9hyvq8s8agy`
  - `cohortBeacon` (CASBeacon): `tb1qwclrvegn2xyyxhnduyqwjc0wm7v34qu8xsqslz`

### 09b-x1-cas-update-announcement-paired

- **DID:** `did:btcr2:x1q4u560prehr04dpjpvyrnnrqkhhvthu0vqheke3c25klfvxynnmuxcxpaa4`
- **Cohort:** cas-09
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mzqgk26Z7ryyHCrkhBgna8SP9oKCY4WHU3`
  - `initialP2WPKH` (SingletonBeacon): `tb1q6065lrgntewnzdy3gr9wzyu42rmt88gllgtels`
  - `initialP2TR` (SingletonBeacon): `tb1pa280rwnfylxw2cn30lq7e4zamd8kehjx4sdzd985qmqwjakmhglsse20ff`
  - `cohortBeacon` (CASBeacon): `tb1qwclrvegn2xyyxhnduyqwjc0wm7v34qu8xsqslz`

### 10a-x1-sidecar-update-cas-announcement

- **DID:** `did:btcr2:x1qhem7zpyek2zlmgpzafggwzztytvj7kzh2cpzu479r4d75dmu02zkmw29ka`
- **Cohort:** cas-10
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mg4iCpQ9XPDvvWXoYyymhUfUPE951jPnD8`
  - `initialP2WPKH` (SingletonBeacon): `tb1qqcqccl484wewym404gsj52aad92srd3thwqq6c`
  - `initialP2TR` (SingletonBeacon): `tb1p89vs98p0c20vmv5q6z3jwm2qedvhxvqehgkk69msktdwxhk5gfrqrkvxa6`
  - `cohortBeacon` (CASBeacon): `tb1qu78dnr90dat7rtkqsxhsd9hy7nkhwm5cwukcsn`

### 10b-x1-sidecar-update-cas-announcement-paired

- **DID:** `did:btcr2:x1q52dx36qyfpxkald3dmz32vufm8n5z4dzsf92q3dzsxt8m7sqylcvknl37x`
- **Cohort:** cas-10
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `n3Aky3T9sYoHL3knJ5xughtisNwfTJiwj2`
  - `initialP2WPKH` (SingletonBeacon): `tb1qakq0mamjdzgrjkp7vmpg2fq63d2yj4lq5dkghf`
  - `initialP2TR` (SingletonBeacon): `tb1pawhe4f87plg3tu0cv86g8t3q4x50dku6hzwva5ssspk08qhr0cfsvv92wd`
  - `cohortBeacon` (CASBeacon): `tb1qu78dnr90dat7rtkqsxhsd9hy7nkhwm5cwukcsn`

### 11a-x1-cas-update-smt-proof

- **DID:** `did:btcr2:x1q4as9ul0mh4p6r49gk8lghyw4xp4zgtc03ap79d5cpuqk6m3dqyx6e9s8cv`
- **Cohort:** smt-11
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mhgKUzVnsJ1C7TpJUtFzrY9G6aP1SUUfqH`
  - `initialP2WPKH` (SingletonBeacon): `tb1qz766a092jzzk78c7sltkj8s87esl6g25qqtd9h`
  - `initialP2TR` (SingletonBeacon): `tb1plh9626xvc6uag9hmp63tv9sh577tt2deyyhcchu0g67pywsqw4zs0s0c8s`
  - `cohortBeacon` (SMTBeacon): `tb1qs8rz5j2htw20g2yf85cr82n707elaedx48jja6`

### 11b-x1-cas-update-smt-proof-paired

- **DID:** `did:btcr2:x1qklrxhg4xckgt5sjpxlrzjy9yz36gr9adn3u00g04wqcy3ac74swvm4kkf4`
- **Cohort:** smt-11
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mjrgxpY7tWrqGy7TUbKZzaLaV7Y1WhTePY`
  - `initialP2WPKH` (SingletonBeacon): `tb1q97wqvv8dnrfj66gfd653cxfuef0rthelh2fzvj`
  - `initialP2TR` (SingletonBeacon): `tb1pld7g54zfdccjcj3dcsnedcprk85rgdp8c8d9pau0lf2g3dyysjlqaysaae`
  - `cohortBeacon` (SMTBeacon): `tb1qs8rz5j2htw20g2yf85cr82n707elaedx48jja6`

### 12a-x1-sidecar-update-smt-proof

- **DID:** `did:btcr2:x1q4zfcvh0p2nq54nu0p7xzalha3l9c8f9zhtzzus7zrt8fa9ap4ttuacumxn`
- **Cohort:** smt-12
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `my7yuzgG4VPZvqJgYQgRt1ezCt1mCww85c`
  - `initialP2WPKH` (SingletonBeacon): `tb1qcydqerx7lapgn8afzqfcgrjl8t48yp8tlsvp8c`
  - `initialP2TR` (SingletonBeacon): `tb1p09k3jhp63mv55lnfpjfpj8uds2t3guhqrde83e2xz8dnj6z9vjfq3m8f20`
  - `cohortBeacon` (SMTBeacon): `tb1qtwtl8wja847rajwvz9vxsagalkwc3hfsnsqmdd`

### 12b-x1-sidecar-update-smt-proof-paired

- **DID:** `did:btcr2:x1q53st3h5ehmh3hst0ykmperqtartdcwj9q7q4e7vas9ydv208juvyw8h6hw`
- **Cohort:** smt-12
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mvHkzZ6uTWYwKBXebtK42a1gqMjcLStMUo`
  - `initialP2WPKH` (SingletonBeacon): `tb1q5g9shzy60e9ppv03fc4dtf6vqxugmp9gt2cmqf`
  - `initialP2TR` (SingletonBeacon): `tb1pyk57psyprtwkhe59qcg8wq79dh7zl8mjrwvaeylkajplu44fgkpsvnktmr`
  - `cohortBeacon` (SMTBeacon): `tb1qtwtl8wja847rajwvz9vxsagalkwc3hfsnsqmdd`

### 13-k1-update-p2wpkh

- **DID:** `did:btcr2:k1q5p08ynfqe6vfxevtz9tzcx675m8gzc7u7g3gesw8tqzdjw990x6zyclsqwn9`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `n2rZXRwyLy58Piu7kupFuXc8ne8S6Q1qnG`
  - `initialP2WPKH` (SingletonBeacon): `tb1qag8lg2mswazfmgfr4wdexx3ra0s9lu0rcnzd9j`
  - `initialP2TR` (SingletonBeacon): `tb1pqh3gcz84fmuxflwsku4u27knkv2qflj8y6htydlg9e385sqczzcslhnpgj`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1qag8lg2mswazfmgfr4wdexx3ra0s9lu0rcnzd9j`

### 14-k1-update-p2tr

- **DID:** `did:btcr2:k1q5p8svrzjd2yuw40adkpjtfs88ffx89wjk8vph6hxjecq85uf2xcthqx8ta75`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mo3UWtMspsZtCgaXZ7vRNt2GzCwGU6UeDA`
  - `initialP2WPKH` (SingletonBeacon): `tb1q228fvdjncez79xh45t2xeryz79xtkv3fpywz9q`
  - `initialP2TR` (SingletonBeacon): `tb1pg9z4mrrh3ljlagqlupekl4lkztsgr5jdwflj8ja5krj06yhn50hswxde24`
- Anchors:
  - update 1 at `initialP2TR` (p2tr, key genesis): `tb1pg9z4mrrh3ljlagqlupekl4lkztsgr5jdwflj8ja5krj06yhn50hswxde24`

### 15-x1-beacon-rotation

- **DID:** `did:btcr2:x1q5rp7phec5m3argcn3cd56hturnf3khhg77jtatnh0tad5zw58qvueynzwy`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mvazXLGn91eanKdVQwmn9m5xbpBee5MMQo`
  - `initialP2WPKH` (SingletonBeacon): `tb1q54xkj3kklclpmah6p6tpxqctm7nhlnsu5uj94f`
  - `initialP2TR` (SingletonBeacon): `tb1pt94td6wlzz5ezf3t5apdv8puvl88l9uy8gq8tztzr6zdrhu3j7tqm20f87`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1q54xkj3kklclpmah6p6tpxqctm7nhlnsu5uj94f`
  - update 2 at `initialP2PKH` (p2pkh, key rotated): `mrtQKFuBcCAPsHcrGHSqbTbXNQQ63iyt8V`

### 16-x1-beacon-add-then-use

- **DID:** `did:btcr2:x1qk58te4eu8lewrks6zmaa0uux2af9hwkpem8gad7twe3v50ff38julf2tj5`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mpCRedyzHeQCa4Z7DSprJdSpDgKX49uTtd`
  - `initialP2WPKH` (SingletonBeacon): `tb1qtuupqswftvyat3yu8advx53d67wp26ce8h7s6t`
  - `initialP2TR` (SingletonBeacon): `tb1pljmm0ms0ns2eq8sahz3wdnh7yhnhskvyz7lcucfgna6wfc2pgfhs57mv48`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1qtuupqswftvyat3yu8advx53d67wp26ce8h7s6t`
  - update 2 at `newBeacon` (p2wpkh, key newBeacon): `tb1qpugdfd6hj42vqy8w43uweg4pcw73va4he6cdrc`

### 17-x1-vm-add-rotate-authentication

- **DID:** `did:btcr2:x1qkj4a5xu70hrzymaqg47aeupxjuq5p6hsrvdy5hdzthryer2aqp075scyrt`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `n3cShBNiiZAefi7cbToxG4oUZGQTxY15PD`
  - `initialP2WPKH` (SingletonBeacon): `tb1q7fwgmxypm9pl5st9h544xxvgf23gshqqza3sva`
  - `initialP2TR` (SingletonBeacon): `tb1pmp59nrj90r98fkfjv9jplpc04r0j7wgxgwd9mrgjh70x6s4ppscs23wa55`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1q7fwgmxypm9pl5st9h544xxvgf23gshqqza3sva`
  - update 2 at `initialP2WPKH` (p2wpkh, key genesis): `tb1q7fwgmxypm9pl5st9h544xxvgf23gshqqza3sva`

### 18-x1-embedded-invocation-key

- **DID:** `did:btcr2:x1q4nw2tdlfcctnshvfcjnjq7f5mgaem3cjup2dusn00m5q02vym3s6pxhn95`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mjQTVM5kAico4BmocVZKdycjL3ArGyoPc7`
  - `initialP2WPKH` (SingletonBeacon): `tb1q92jlvspjmlrrgk2jd52stcwpzepvk2f5aes05s`
  - `initialP2TR` (SingletonBeacon): `tb1pyvr22v8xd4cysf6llfus0x6pd3dlfledx93texry5geh3nxk5nmsnl7rlz`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1q92jlvspjmlrrgk2jd52stcwpzepvk2f5aes05s`

### 19-x1-relative-ids

- **DID:** `did:btcr2:x1q5pzvvxz42epmdh6km4j0svrtaqml74huyrm7xjj75lmspkjmx6kg3k4wc8`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mno1sffwEQoxKsW9MR7vYf9MwvXHf9AxNZ`
  - `initialP2WPKH` (SingletonBeacon): `tb1qflfgvgppj0k0m7d4vrfc4kszmettjxusp8gqsw`
  - `initialP2TR` (SingletonBeacon): `tb1pr5a9w60epj67nhuc7k7lw84hat07n27tuwqelejece83grmwgcgqlemscs`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1qflfgvgppj0k0m7d4vrfc4kszmettjxusp8gqsw`

### 20-k1-cas-update

- **DID:** `did:btcr2:k1q5pj0t23nnlqdd72007acs2j6ql78rwae2h2mzp3a867llwz3sadv5qul5uzk`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mqnTnnYCt46PueCrwMxKdF3Uo7GbFPCPUa`
  - `initialP2WPKH` (SingletonBeacon): `tb1qwzspueme8rkxuaqf6s7g2y5mvzdah9gjgyt276`
  - `initialP2TR` (SingletonBeacon): `tb1pus9dsrv4l45cqk4ht80wrng26w8s4vqad822t6hkqew6flsdug8qg0ec6j`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1qwzspueme8rkxuaqf6s7g2y5mvzdah9gjgyt276`

### 21-k1-deactivate-then-update

- **DID:** `did:btcr2:k1q5pzmjfx5q7hss5vhcydfxdlcfe2f7ly89hatcfq8vkw43zw83ch52c0ja9xc`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mm8B7y38rzZ9owspZ1GH48p3mbQdrkjKAS`
  - `initialP2WPKH` (SingletonBeacon): `tb1q8kq7fmsa2lfhqfpz42vqe8fj4qf4y9qzzzpw5z`
  - `initialP2TR` (SingletonBeacon): `tb1pxpejpghm8cr7lajjdlm3yv6va5xe9mwpppx3awlyuj6d4uxg7xmsj6a988`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1q8kq7fmsa2lfhqfpz42vqe8fj4qf4y9qzzzpw5z`
  - update 2 at `initialP2WPKH` (p2wpkh, key genesis): `tb1q8kq7fmsa2lfhqfpz42vqe8fj4qf4y9qzzzpw5z`

### 22-x1-three-updates-resolution-options

- **DID:** `did:btcr2:x1qhfjzym7ah9q7zadrummn48wqs5ulrpufull05whrlz7lhemtank2vpvv50`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `n2YTUQ9xLEf3uUKzgMKB4BryMQQTGPMZGP`
  - `initialP2WPKH` (SingletonBeacon): `tb1qu63k5rlsrhmh8fsnw6v0uwmlknp5k476t6eahf`
  - `initialP2TR` (SingletonBeacon): `tb1pe86ey3kjzrxx6hv99tp9wcy6wtq7rqmaxvm8a7cwnpecqgdq524qwmpq2z`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1qu63k5rlsrhmh8fsnw6v0uwmlknp5k476t6eahf`
  - update 2 at `initialP2WPKH` (p2wpkh, key genesis): `tb1qu63k5rlsrhmh8fsnw6v0uwmlknp5k476t6eahf`
  - update 3 at `initialP2WPKH` (p2wpkh, key genesis): `tb1qu63k5rlsrhmh8fsnw6v0uwmlknp5k476t6eahf`

### 23-k1-duplicate-signal

- **DID:** `did:btcr2:k1q5p97uqzjlumn2d6zmv0wa8aqhrasyxxhlmdhzkfa8hf5f0vj5am6gqah3p5x`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `msbM7nwrDCstVEgySJMRCxUnDQjj6Nh93W`
  - `initialP2WPKH` (SingletonBeacon): `tb1qs3mrnx0t2gk4006qvfppg50ahryrvzzgwx9sg0`
  - `initialP2TR` (SingletonBeacon): `tb1pfss2f25uh73tlvyf5xkrmfp4tgr9urfuldc9vklfvmuwx029mzaqrxup5x`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1qs3mrnx0t2gk4006qvfppg50ahryrvzzgwx9sg0`
  - update 2 at `initialP2WPKH` (p2wpkh, key genesis): `tb1qs3mrnx0t2gk4006qvfppg50ahryrvzzgwx9sg0`
  - update 3 at `initialP2WPKH` (p2wpkh, key genesis): `tb1qs3mrnx0t2gk4006qvfppg50ahryrvzzgwx9sg0`

### 24-k1-removed-beacon-signal

- **DID:** `did:btcr2:k1q5paaduz7faxp708a0r7tppmcx96naa6g3k4rsny9wnujq804mqhdrqtljr5a`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `msPqUa5A3Y75gzESB6qeLrVSgnggT9KNr7`
  - `initialP2WPKH` (SingletonBeacon): `tb1qsfyw0hs8mcl66gcscar3tgk6vdah3r39qf79q6`
  - `initialP2TR` (SingletonBeacon): `tb1py6claj7mez9jhft9ygua5dkez6x488e9gd30sm4xe5w2sqmsmutsth2ydz`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1qsfyw0hs8mcl66gcscar3tgk6vdah3r39qf79q6`
  - update 2 at `initialP2PKH` (p2pkh, key genesis): `msPqUa5A3Y75gzESB6qeLrVSgnggT9KNr7`

### 25a-x1-smt-update-no-nonce

- **DID:** `did:btcr2:x1qhwkcy3urqtl3xujdvc3zvfrqmp39uea26zylpyfqlpcd0jul90ngcgjw3j`
- **Cohort:** smt-25
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mkqc1Au2FdfT9XDJgmkNiNQGUjd34zUpEL`
  - `initialP2WPKH` (SingletonBeacon): `tb1q8f0esylp9e760wt25jszzru4lzc5j8nc6vhegl`
  - `initialP2TR` (SingletonBeacon): `tb1pusgucz4tqyxwll8333psp6ysjy2828cnm00202v3qqupvgtz4r2qq52y0a`
  - `cohortBeacon` (SMTBeacon): `tb1qvmfyta8vyxs4gadxu5pqqwlztsp6df44rpqk5h`

### 25b-x1-smt-nonce-no-update

- **DID:** `did:btcr2:x1qhyt2nkmft2phudewsuuu98hgykpqzhpfxe2fyyr74t997z2h6mnx860qts`
- **Cohort:** smt-25
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mnf6qnUFT8zEqrcRixBsYfZ5nC8A5ZqMZ3`
  - `initialP2WPKH` (SingletonBeacon): `tb1qfef40j0heqd9egr3dnzq2n558kez7wzrg4v65h`
  - `initialP2TR` (SingletonBeacon): `tb1pkdc37zhc6zgu5mt9fql4uh6tdsfkkvvh4pt00xpjxs8nvw2y36as7c73r3`
  - `cohortBeacon` (SMTBeacon): `tb1qvmfyta8vyxs4gadxu5pqqwlztsp6df44rpqk5h`

### 25c-x1-smt-empty-index

- **DID:** `did:btcr2:x1qh2etls95sweswwnfm5724pmvvra5uszmt5lshsv30hvzyp2ued5w9ajeus`
- **Cohort:** smt-25
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `n2f7iixMjewpK7yP2hwk1U6StcpYQd95LP`
  - `initialP2WPKH` (SingletonBeacon): `tb1quljavjq40vqg32gczencdajgmkhz2jn3ydpf2q`
  - `initialP2TR` (SingletonBeacon): `tb1ps3c6hyn2u0wpk3d6ullyqpjvg4rcw4mushra50yr7fkdqxa46dtqwymu7z`
  - `cohortBeacon` (SMTBeacon): `tb1qvmfyta8vyxs4gadxu5pqqwlztsp6df44rpqk5h`

### 26-k1-signal-below-current-height

- **DID:** `did:btcr2:k1q5pfvscey4ajk2ye2tsjkja3xvl57m33dvvzyg6c9gmg9aw8f9hjvjgeah685`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mhDifuh9k2yLVvLZaGMyunSRiagKYyxD8f`
  - `initialP2WPKH` (SingletonBeacon): `tb1qz2kuac6p7n33edy7mynac964zezvfl500ly5mn`
  - `initialP2TR` (SingletonBeacon): `tb1pmdn4ruk5ynu9urhefjmlk97lyyhct2j47tggjtqushz0jzz9c0ksh6rgcf`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1qz2kuac6p7n33edy7mynac964zezvfl500ly5mn`
  - update 2 at `lateBeacon` (p2wpkh, key lateBeacon): `tb1qzjpgtampg3s564x2afp3g9e5mycvfla7zmc765`

### n01-k1-invalid-did-checksum

- **DID:** `did:btcr2:k1q5pl0phtl880rcejyml83jz77wllrdgs798hwttgszkkys0aquju20c4vt998`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mzmtqDu3jZKT9gerARxd3qn1aAzYSSNYra`
  - `initialP2WPKH` (SingletonBeacon): `tb1q6v7m6fu5x5pn8zm24dvy9pnfqdw5sj8yf3cgfh`
  - `initialP2TR` (SingletonBeacon): `tb1psc7h3zun5nvfqdzn4lphcnuewlzw6e4u9fs0muwh4ac8k86ahruq5ntakh`

### n02-x1-invalid-did-padding

- **DID:** `did:btcr2:x1qkvngz35q6m29szyc5pwk6n3543je49guq0sqmeuyyujfneeu7ve50lc6r0`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mkPWkJuRynYoSNomGZgAE7LtWmnxNQDT87`
  - `initialP2WPKH` (SingletonBeacon): `tb1qx4cxgvqd5fr94ewx54wapjhpllfhladk59v5c4`
  - `initialP2TR` (SingletonBeacon): `tb1pmf2mwdee6j5rt9qjpgs25rkk0tg3jk6974t8wnwm4ev2783y8sjqywle4p`

### n03-k1-invalid-did-network-nibble

- **DID:** `did:btcr2:k1q5pqm8pmwacx2590xjkaj727dcc8z9gmp7jlrgc2u4duehqa8rvrpfq08jhds`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mvhUehxuXyM56FjTcvscM4wFf7j6ZUS2M4`
  - `initialP2WPKH` (SingletonBeacon): `tb1q56rk96yqhdvx2pwx4ayltungssf8k6ycvprldg`
  - `initialP2TR` (SingletonBeacon): `tb1p9na8n2rvem4rxkw3cvzyqshf9wu86dhe2087m3zhhawrtfts23kqv803zm`

### n04-x1-genesis-hash-mismatch

- **DID:** `did:btcr2:x1qhtj39nc6q8yampkdsa3t6z5wldrju4xmkr2tvfz2unf70m0eqk0sxmqvqp`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `n3euzvR6CQqsbNWqzb2V4BaH34eCMqfsZR`
  - `initialP2WPKH` (SingletonBeacon): `tb1q7t2zmj84aqfw5lj3svarr880tmhdj028gugttz`
  - `initialP2TR` (SingletonBeacon): `tb1pjewtyhjgnhaugy74r5m3yl9ljmm2wvhvylk3gtf3nqls9va7mlhqzcetfr`

### n05-x1-missing-update-data

- **DID:** `did:btcr2:x1qhwufjvyunn93ua3zla7n6u5u9zec7grkq9vuvpwzqpfmecpfz36k8mjd07`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mzeAXykqF2xr9wDRBb8RHRgWZBC1Swj3m1`
  - `initialP2WPKH` (SingletonBeacon): `tb1q68rcfej994krjanvqzmgmm76vy8rggaa9nl35f`
  - `initialP2TR` (SingletonBeacon): `tb1p5ar39zzdr9af3ff4rqpcf459ja0wvkhvqlgrzwjlt54x370lr53qlfe5nj`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1q68rcfej994krjanvqzmgmm76vy8rggaa9nl35f`

### n10-k1-invalid-update-context-member

- **DID:** `did:btcr2:k1q5ppjlgm7kc3062weg82zefm7gv35937h03vn4prhvam5a7g8eg6tcsd56a8z`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mrpu9v13MnZBjz4cSc2aXKeveoYLha8cM8`
  - `initialP2WPKH` (SingletonBeacon): `tb1q0s8rlcp04vhuww5s696ywllqp82cjhzfn6ceuh`
  - `initialP2TR` (SingletonBeacon): `tb1pwsuwsvxjdz5a2a9ufj67v3tfuvnsghqjrmzxh7xl723qtxtmf2as4eg9q9`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1q0s8rlcp04vhuww5s696ywllqp82cjhzfn6ceuh`

### n11-k1-invalid-update-context-order

- **DID:** `did:btcr2:k1q5petkk0fvzw0mhvt8cnkh9l39lwdlktanhw6egnfz76etmad72xz0stgpyvu`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mq5aeZ68LBBMnhVueamFWvfnDRLbjiCLj6`
  - `initialP2WPKH` (SingletonBeacon): `tb1qdrjv5p5fa4an9axhnmavgy3cs6elufwrnc8gnw`
  - `initialP2TR` (SingletonBeacon): `tb1pef5x6lkyl6yk4eg55lzp0zr2r8zw93fjfvvdzvy5z0s3n9rzzukspp40s4`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1qdrjv5p5fa4an9axhnmavgy3cs6elufwrnc8gnw`

### n12-k1-invalid-update-proof-context

- **DID:** `did:btcr2:k1q5pqp5tnnc9a66fg72xl4kqft6pjwp7nuvk6767zv2q7nj5wxltur0c4qdlvt`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `moSEB2kcPEwVLfxSyqwssaig6aiBPFQcwu`
  - `initialP2WPKH` (SingletonBeacon): `tb1q2mwzuaupg2a307ycss26eng0rpn92rrge4l4pe`
  - `initialP2TR` (SingletonBeacon): `tb1p5hfs07cqy3pemqxdsuq8ayw8cxrh9pzy973xyle0rp5c3edfn7hqs55u4x`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1q2mwzuaupg2a307ycss26eng0rpn92rrge4l4pe`

### n13-k1-invalid-update-capability-action

- **DID:** `did:btcr2:k1q5pueuxw0yz4cuzr8le40tvynxsymxspph8rur8p9p2akm3lplef68g4ztm92`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mp1SZfLENS1UzWBdvTVaUHMQMSXx2s4Xe8`
  - `initialP2WPKH` (SingletonBeacon): `tb1qt5jyq3frf2072gg3wa90wa62larpey7addca04`
  - `initialP2TR` (SingletonBeacon): `tb1pm6es925p6gg8lkt9hpq78u4nekx586rnfnmuqvu35xa23vk3qweq5dfx6a`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1qt5jyq3frf2072gg3wa90wa62larpey7addca04`

### n14-k1-invalid-update-capability-encoding

- **DID:** `did:btcr2:k1q5pggxe7agdh4dhj8haklct27vktr9wffld88v92y2kvffshx5uzj2qu9qg9z`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mgGqSEews6f42ZcNqhhurude7emkmXXSi9`
  - `initialP2WPKH` (SingletonBeacon): `tb1qppxf8fm730z0p8gg6ethzxamdn0avadh8mx5n6`
  - `initialP2TR` (SingletonBeacon): `tb1p6hgldzhkx8ekq8sffytdshqra7zlwxp0u000pu6wz87cqlmrsgfs72lez7`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1qppxf8fm730z0p8gg6ethzxamdn0avadh8mx5n6`

### n15-k1-invalid-update-proof-purpose

- **DID:** `did:btcr2:k1q5p0w6a9tllxq79y7729ct2c9yrsmpumah0jq7c2ey7syuen385wyys3wxd8c`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `n3vKiure6JWVrNnMyCFNbrqANbthNDQdEv`
  - `initialP2WPKH` (SingletonBeacon): `tb1q7klr3kpw7asytqlx8l09k66u6p6gtp4p4sfvct`
  - `initialP2TR` (SingletonBeacon): `tb1pwdfylzyv70vzq22874ut7yyxd3xs2858v0u7d5855nch8ekdwctqrj7q8u`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1q7klr3kpw7asytqlx8l09k66u6p6gtp4p4sfvct`

### n16-x1-invalid-update-unauthorized-method

- **DID:** `did:btcr2:x1q4d3qyzeg8utml3v2ukdsa79yg4fz7pp2c64ruvzg3sckkdp07yjyl6tmtl`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mfqY6X8fhf9yrY4FMmWzNUGdFeMk9USv1o`
  - `initialP2WPKH` (SingletonBeacon): `tb1qqwpm8ltdcc08fmm2daahl6x0mnc380enwzml3z`
  - `initialP2TR` (SingletonBeacon): `tb1p6h6n7j48kpn94jv47xq8yk6gaawd7gw6zjhajw35l7da857cn43sygvvgp`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1qqwpm8ltdcc08fmm2daahl6x0mnc380enwzml3z`

### n17-k1-invalid-update-unknown-method

- **DID:** `did:btcr2:k1q5pyz053tr2fw58ksh9yd03tcdg7tq5my29tg89dl7373xnznmpqf5cmwkuq9`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mrQtefMTUA24n2gSSMV59Qxi1KutEerAH7`
  - `initialP2WPKH` (SingletonBeacon): `tb1qw7pasm2df0nzen33d7gct2m4dsks4rddup3v3d`
  - `initialP2TR` (SingletonBeacon): `tb1pfwj2hwgml9vcavfx6c4gahtnyetlv7q0v6u4yke5ggz4fthdt8cs3w4pfc`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1qw7pasm2df0nzen33d7gct2m4dsks4rddup3v3d`

### n18-k1-invalid-update-proof-value

- **DID:** `did:btcr2:k1q5pduhpu3juz2zuqf3r7wpjv5wqs0wa3q07htczmlczyy762kv9epgcvscp97`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `muWMSjSHfvpfyfuznQv8xfvJs2Day8p3Hz`
  - `initialP2WPKH` (SingletonBeacon): `tb1qn962kknqzm5eyyv5z908jgeqe2q9pg4k5chqly`
  - `initialP2TR` (SingletonBeacon): `tb1psd322dlqep7u7qzk2kmjq2ccew6hmmfaa8rklm9tgrfssdh08xlqs4ua6d`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1qn962kknqzm5eyyv5z908jgeqe2q9pg4k5chqly`

### n19-k1-invalid-update-source-hash

- **DID:** `did:btcr2:k1q5puvng8hdyr9weh67np8jgrxykrpdmp93d6zns0d7njylrtkx4evpcrg5ycx`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mqPX7duTuowsPCbZ8qnmU5rEgqdqJ1Nv1j`
  - `initialP2WPKH` (SingletonBeacon): `tb1qd3y483tefn7usksg0g44q29q5hc64zjf3c0qzg`
  - `initialP2TR` (SingletonBeacon): `tb1psy6r2guz72nc6vg4rpvh3kzernpp90fstydlk4jknwgh47yf7fvqr54lvn`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1qd3y483tefn7usksg0g44q29q5hc64zjf3c0qzg`

### n20-k1-invalid-update-target-hash

- **DID:** `did:btcr2:k1q5pqss3y0vng3z8nh8j7y4z9xjj3swxj074pgtds8w8dh6cvk3zrj9cgwnxy6`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mmntnAfXDFDPabJKSCpunbzCH4wsBiTxCk`
  - `initialP2WPKH` (SingletonBeacon): `tb1qgn28n3s03ccnagc35a7rdfdvv6y490zs4nejjz`
  - `initialP2TR` (SingletonBeacon): `tb1ph4ece9l4wakvtw3maxkrzrt07tys34n4hkusupdrrdhrf3rt3hxq9y3637`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1qgn28n3s03ccnagc35a7rdfdvv6y490zs4nejjz`

### n21-k1-invalid-update-version-skip

- **DID:** `did:btcr2:k1q5pt9ln3nppesqnr359z2u5s2560cnnhmmxl0l6ft7pyl0jltnm7clc5l424m`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mgdu4Ts1L8LGMQyTvHm62fxJFda1ts1hSS`
  - `initialP2WPKH` (SingletonBeacon): `tb1qp3y9vupt00x2thurc9zpc96emjlwxt5vfgx6kl`
  - `initialP2TR` (SingletonBeacon): `tb1p9xfa9qcxqg56lzkdl9s9lt3r6lc26dxs96k7w9f52s9p9ktrq9sqz6puhx`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1qp3y9vupt00x2thurc9zpc96emjlwxt5vfgx6kl`

### n22-k1-invalid-update-patch-missing-path

- **DID:** `did:btcr2:k1q5pkk6xt4gnzgzvq2gtm60tqdz959k7q7xs08c2ps57ccrufexslfegtuzc4c`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mmwLTwQhVBBvZoPZgVfpSFqV1tYVNqSTcj`
  - `initialP2WPKH` (SingletonBeacon): `tb1qgeknafncfnt7p6ayu27xw50j4hj5xlxycdl6j7`
  - `initialP2TR` (SingletonBeacon): `tb1pgulpx698jhgnq7t4m6xh2l22j4hpr7mwdfeh6z4z63ddm26c8vzskpnhkq`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1qgeknafncfnt7p6ayu27xw50j4hj5xlxycdl6j7`

### n23-k1-invalid-update-patch-changes-id

- **DID:** `did:btcr2:k1q5p4s0y99ysey27vjq5feremlljppjjdvya3xdndynsekrgt46shezcpyjhm6`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `n3hvMfZxKoZe8hVd8gnHRcDorJN5Ruvkhb`
  - `initialP2WPKH` (SingletonBeacon): `tb1q7djmnty9udwjgwqwtensnkkn6r6trxwu39kuux`
  - `initialP2TR` (SingletonBeacon): `tb1p0tye6handm43n07xwgl4qvqs98j2xskxqaprczhlp08ysvqha0msdc62sy`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1q7djmnty9udwjgwqwtensnkkn6r6trxwu39kuux`

### n24-k1-invalid-update-patch-invalid-document

- **DID:** `did:btcr2:k1q5pe44p3ey720th3eyk3hzlpuyvkgqupeetj995qkrqnjxlu7yuxhjc78mykd`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mnLi9FmfqcfTg4jf4HD2g2fi8EKpR9n5fN`
  - `initialP2WPKH` (SingletonBeacon): `tb1qftvwsksaayy4a3q8a872jyzxdhm9qj0228vvwx`
  - `initialP2TR` (SingletonBeacon): `tb1pv60humjykz9uzzfegr6mpwl2yte0dxyn93tly4grmsgzczhhcassd3xdlp`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1qftvwsksaayy4a3q8a872jyzxdhm9qj0228vvwx`

### n25-k1-invalid-update-created-after-block

- **DID:** `did:btcr2:k1q5py5sz0y95squtux2u7lcfqvk6r4l02pnkuyccu5crzm0x9rg3d96qecha6v`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mwvnECksH3Ha5ekj2foo2T6VzaKUff9RZ1`
  - `initialP2WPKH` (SingletonBeacon): `tb1qkspe0djjh9s26xdq6y32l8ft73hlfr0astagks`
  - `initialP2TR` (SingletonBeacon): `tb1pqu6ald8mdxllf6qtj68f036jt7kex46zyhnuvuw2udrlt3zqnefsk43yxj`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1qkspe0djjh9s26xdq6y32l8ft73hlfr0astagks`

### n26-k1-invalid-update-expires-before-mediantime

- **DID:** `did:btcr2:k1q5p9zf8suw8g820as33sz40ye68tddfc4s88j7wppaqdyh33cq3ukws60pu42`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mwNhBFq528Re55Tsa31Z5CVwdny4JbuxgU`
  - `initialP2WPKH` (SingletonBeacon): `tb1q4heppnstds8gy8k7zw2k5pnvaykt9qgmy8s0j4`
  - `initialP2TR` (SingletonBeacon): `tb1pz4r45gd3fc570ngfh7q2eayuv0ge6he3slaa39vm655s6vyqy25sk64hyq`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1q4heppnstds8gy8k7zw2k5pnvaykt9qgmy8s0j4`

### n27-k1-invalid-update-expires-before-created

- **DID:** `did:btcr2:k1q5pmrprxxyvfn20v273mpv0kzq27dmk7y2pl3uchftpcs3dt6ymu6ggt3ppnw`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `msspKGBLyQWBxGF3ePjDtcTYnNmrgLHnuV`
  - `initialP2WPKH` (SingletonBeacon): `tb1qs7fe2ly4ase7pnlsdhgnnxcrznyekr6uryqhtd`
  - `initialP2TR` (SingletonBeacon): `tb1pnevavyvv7wyelg97nwcem5cgup33v9jf9w7tq9np0nmrxtn38tlq92efr2`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1qs7fe2ly4ase7pnlsdhgnnxcrznyekr6uryqhtd`

### n28-k1-late-publishing

- **DID:** `did:btcr2:k1q5ptfnefs7994nc4yjtmy495930nxvwvy8mr0wqv6d7u70sewyt3c5sxzjx32`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `n37stw1K3MQsf8Re14nyCyiEVzRRshDya8`
  - `initialP2WPKH` (SingletonBeacon): `tb1qan6cw0ectkvq3ytswrzywymqy5wwngwlzt6cmt`
  - `initialP2TR` (SingletonBeacon): `tb1pwt742kvzrcgdzd0xkmwrmdq4qww3fvs3q4hvl0y3pgrxlgzhls2q9x4cu7`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1qan6cw0ectkvq3ytswrzywymqy5wwngwlzt6cmt`
  - update 2 at `initialP2PKH` (p2pkh, key genesis): `n37stw1K3MQsf8Re14nyCyiEVzRRshDya8`

### n29-x1-smt-proof-hash

- **DID:** `did:btcr2:x1qk66z56azfryzcx5henteegzv36c6mqxpuf2r3l5tyswqy8s4ep8xxyp5we`
- **Cohort:** smt-25
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mwUawkMP4pti1ahucRkA7WrWAzNyZD6DtL`
  - `initialP2WPKH` (SingletonBeacon): `tb1q4u84hsmc8a2x4848pm8fscnpts2gkz0tx7c6wg`
  - `initialP2TR` (SingletonBeacon): `tb1py90a9axcxalzrwrx2sd4r9ttkt5zczzmz04utyeehqzml2pusdmsypg43s`
  - `cohortBeacon` (SMTBeacon): `tb1qvmfyta8vyxs4gadxu5pqqwlztsp6df44rpqk5h`

### n30-x1-smt-proof-root-id

- **DID:** `did:btcr2:x1q5cegwvpwtupp0qhjwdhqew4yrf5zqqxw2p5amgw7q882vlek35g6c8qwj9`
- **Cohort:** smt-25
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mqCpidSPAy3dZpWfe1YqAUEveYAia5UEcR`
  - `initialP2WPKH` (SingletonBeacon): `tb1qdfphydehyymaw4vsdk0945j4c7zu73kpf2zwd3`
  - `initialP2TR` (SingletonBeacon): `tb1p6sek4tg9m6nhtl7m8dgu4d3avxwmga2xrvvd37xt3j7f87edcycs5jgem0`
  - `cohortBeacon` (SMTBeacon): `tb1qvmfyta8vyxs4gadxu5pqqwlztsp6df44rpqk5h`

### n31-x1-smt-proof-withheld

- **DID:** `did:btcr2:x1q5x8n94l7ygjc7rmz2hd5y76ln4eq5mra6fuxyc7z5gsy57fj7kewka4sga`
- **Cohort:** smt-25
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mrkM6P649Yy7xWeB6MFZVvcvpmraLwixnf`
  - `initialP2WPKH` (SingletonBeacon): `tb1q0vca9yu4jl98q6ampa58nqp5p44lfa5nt6mt4t`
  - `initialP2TR` (SingletonBeacon): `tb1psg2ju0ynryr8upq8wm0dw5qgjrfcqdpkk6ygz6cks82aemstqf6qu4vc74`
  - `cohortBeacon` (SMTBeacon): `tb1qvmfyta8vyxs4gadxu5pqqwlztsp6df44rpqk5h`

