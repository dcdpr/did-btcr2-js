# Test Vector Funding Targets (testnet4)

Generated from 48 scenarios: 37 anchor their own beacons, 4 are cohort members (one shared anchor per cohort), 7 need no funding.

## Solo beacon addresses

Each address carries one OP_RETURN per anchor. Fund each address once; the anchor step chains the change.

| Address | Type | Anchors | Scenarios |
|---------|------|---------|-----------|
| `mqPxvdqG4K6fBA7zXtHUg6u7bYAHZcQHF2` | p2pkh | 1 | 02-k1-sidecar-update |
| `mhmrBVeeqjFcraMuQFiuTQQpqvTFYxrjVb` | p2pkh | 1 | 04-x1-sidecar-update |
| `tb1qqckwgtxtctqavkh26etymy9e6rcm3ngt76jyh7` | p2wpkh | 3 | 06-x1-cas-3-updates |
| `mkvpLbfg5Xk8YSkWHSJaaYHij3Qqi1XENh` | p2pkh | 1 | 07-k1-sidecar-deactivate |
| `tb1qlppx7g0m9s4jdr4k57e6m5llwtel287cseda8s` | p2wpkh | 2 | 08-x1-cas-update-deactivate |
| `tb1qpwejz3erq0ls69acxl5sz2r9n9ytp7ntqu36qa` | p2wpkh | 1 | 13-k1-update-p2wpkh |
| `tb1px733ygvcrxjyydlmx7hfq7tve7llx295nvm6369fz03y3qlgpqdqczh893` | p2tr | 1 | 14-k1-update-p2tr |
| `tb1qvclay4ga48hpzyztqjqphatz4zd2k22g2a633v` | p2wpkh | 1 | 15-x1-beacon-rotation |
| `mwtgHduMEgj9xkqAfwRnWM3QL4vnz3gfQx` | p2pkh | 1 | 15-x1-beacon-rotation |
| `tb1qhmcph49wsq7hgmpfmpdtwx298mps3hdjykxhfp` | p2wpkh | 1 | 16-x1-beacon-add-then-use |
| `tb1qathq9ct9zfjchxzv0v8jv55dfrj7jcxvg6g79c` | p2wpkh | 1 | 16-x1-beacon-add-then-use |
| `tb1qkk6pcprxxnhyc3ruhrsd8v0yczzjxcrak995dp` | p2wpkh | 2 | 17-x1-vm-add-rotate-authentication |
| `tb1qk02dn5eek4p4sx8n6rg2lna8pt4lharxdsknmt` | p2wpkh | 1 | 18-x1-embedded-invocation-key |
| `tb1qhlzmfw9luplp7rxqxualfrfuuyx79up62eym3q` | p2wpkh | 1 | 19-x1-relative-ids |
| `tb1q453zmpzqt7ypnxv9tx6mgf5fclakew4qrvz5s8` | p2wpkh | 1 | 20-k1-cas-update |
| `tb1q5e5pqy4t0lfkvkn5rtlws6vssnc4dsg88fltlk` | p2wpkh | 2 | 21-k1-deactivate-then-update |
| `tb1qqq0h4gxsr2aepshkzll8c47ekmpq853d4yv7fa` | p2wpkh | 3 | 22-x1-three-updates-resolution-options |
| `tb1qejynvzv27lm3fx50rsp6psdkvgczurr8qypu20` | p2wpkh | 3 | 23-k1-duplicate-signal |
| `tb1q72hq0hzexmutcclhgqrmkj9xz8a5z65e7mhvev` | p2wpkh | 1 | 24-k1-removed-beacon-signal |
| `n3e8JLp9wvkgqNfC1yGyL2eYSRYxqK9Rnp` | p2pkh | 1 | 24-k1-removed-beacon-signal |
| `tb1qrmjs09uhnshva596ngd6h22yuz8vupd7tnvddn` | p2wpkh | 1 | n05-x1-missing-update-data |
| `tb1q0rt8v302ruzz3m4f0yrf3sl2ntlnamzc9ysa0k` | p2wpkh | 1 | n10-k1-invalid-update-context-member |
| `tb1q5hljzuzt92rtx9jc9lpe9yuln56ps4qud4x2t5` | p2wpkh | 1 | n11-k1-invalid-update-context-order |
| `tb1q60m0dt03clz75f7espy0zpzl8zwgzrs0pcat9c` | p2wpkh | 1 | n12-k1-invalid-update-proof-context |
| `tb1qeqql0ehsq7dqjztqjylf3tjwnzsc4uvxe9zra7` | p2wpkh | 1 | n13-k1-invalid-update-capability-action |
| `tb1qg34fr96ysy52feflhy894r0vax9wnpgqlw6jnj` | p2wpkh | 1 | n14-k1-invalid-update-capability-encoding |
| `tb1qcjlnn6dch35huwg86rg6usgqptl6pnhlnujthx` | p2wpkh | 1 | n15-k1-invalid-update-proof-purpose |
| `tb1qv43fay4ekrracew47cf4kxlqnht3elj07grvrh` | p2wpkh | 1 | n16-x1-invalid-update-unauthorized-method |
| `tb1qr7lzyqwz3hy0whw5g070e3ss03kdcztqyh3hw7` | p2wpkh | 1 | n17-k1-invalid-update-unknown-method |
| `tb1qazxwj8gxmpm8v56q2nt3suahrrnjr52ae9vtpa` | p2wpkh | 1 | n18-k1-invalid-update-proof-value |
| `tb1qc9zphyc3ytm7pgf9th4zwlrzyaynp8lwfv9y96` | p2wpkh | 1 | n19-k1-invalid-update-source-hash |
| `tb1qa6nkma5q4l3ksntjy0qtuxk3y6e3lrg6hpf4wy` | p2wpkh | 1 | n20-k1-invalid-update-target-hash |
| `tb1qtcyxuf4y8ygez52cc3gvgy38dp344w48kuutv8` | p2wpkh | 1 | n21-k1-invalid-update-version-skip |
| `tb1qflk3mrzadw9x54q9u56yezut2np3yr0f3j7gry` | p2wpkh | 1 | n22-k1-invalid-update-patch-missing-path |
| `tb1qs68qmujm6sps63td6lnls7gpke07d98s5a2c2a` | p2wpkh | 1 | n23-k1-invalid-update-patch-changes-id |
| `tb1qplyrx6lcqsauzhakhkd6m6ac9tr9r7p82z2fgv` | p2wpkh | 1 | n24-k1-invalid-update-patch-invalid-document |
| `tb1qj4alansrvzzmk8n8yamud8z4d7k5aneklwzny2` | p2wpkh | 1 | n25-k1-invalid-update-created-after-block |
| `tb1q9fcf6gqf4w8t5gyateq9x5p495fllemehdz5v8` | p2wpkh | 1 | n26-k1-invalid-update-expires-before-mediantime |
| `tb1q6l5fecla6nzqszf3ls8pzp29l37qzarrds3rue` | p2wpkh | 1 | n27-k1-invalid-update-expires-before-created |
| `tb1qltdqkgwxydt52v5t34s756x66m5k2wsvq5mqdv` | p2wpkh | 1 | n28-k1-late-publishing |
| `n4PLRwPMjoYdQpYqiWqWDffVUe2PKDectr` | p2pkh | 1 | n28-k1-late-publishing |

## Cohort beacon addresses

One shared address per cohort, funded once, one OP_RETURN for every member.

| Cohort | Type | Members |
|--------|------|---------|
| cas-09 | CASBeacon | 09a-x1-cas-update-announcement, 09b-x1-cas-update-announcement-paired |
| cas-10 | CASBeacon | 10a-x1-sidecar-update-cas-announcement, 10b-x1-sidecar-update-cas-announcement-paired |
| smt-11 | SMTBeacon | 11a-x1-cas-update-smt-proof, 11b-x1-cas-update-smt-proof-paired |
| smt-12 | SMTBeacon | 12a-x1-sidecar-update-smt-proof, 12b-x1-sidecar-update-smt-proof-paired |

### Plain list (41 solo addresses, one per line)

```
mqPxvdqG4K6fBA7zXtHUg6u7bYAHZcQHF2
mhmrBVeeqjFcraMuQFiuTQQpqvTFYxrjVb
tb1qqckwgtxtctqavkh26etymy9e6rcm3ngt76jyh7
mkvpLbfg5Xk8YSkWHSJaaYHij3Qqi1XENh
tb1qlppx7g0m9s4jdr4k57e6m5llwtel287cseda8s
tb1qpwejz3erq0ls69acxl5sz2r9n9ytp7ntqu36qa
tb1px733ygvcrxjyydlmx7hfq7tve7llx295nvm6369fz03y3qlgpqdqczh893
tb1qvclay4ga48hpzyztqjqphatz4zd2k22g2a633v
mwtgHduMEgj9xkqAfwRnWM3QL4vnz3gfQx
tb1qhmcph49wsq7hgmpfmpdtwx298mps3hdjykxhfp
tb1qathq9ct9zfjchxzv0v8jv55dfrj7jcxvg6g79c
tb1qkk6pcprxxnhyc3ruhrsd8v0yczzjxcrak995dp
tb1qk02dn5eek4p4sx8n6rg2lna8pt4lharxdsknmt
tb1qhlzmfw9luplp7rxqxualfrfuuyx79up62eym3q
tb1q453zmpzqt7ypnxv9tx6mgf5fclakew4qrvz5s8
tb1q5e5pqy4t0lfkvkn5rtlws6vssnc4dsg88fltlk
tb1qqq0h4gxsr2aepshkzll8c47ekmpq853d4yv7fa
tb1qejynvzv27lm3fx50rsp6psdkvgczurr8qypu20
tb1q72hq0hzexmutcclhgqrmkj9xz8a5z65e7mhvev
n3e8JLp9wvkgqNfC1yGyL2eYSRYxqK9Rnp
tb1qrmjs09uhnshva596ngd6h22yuz8vupd7tnvddn
tb1q0rt8v302ruzz3m4f0yrf3sl2ntlnamzc9ysa0k
tb1q5hljzuzt92rtx9jc9lpe9yuln56ps4qud4x2t5
tb1q60m0dt03clz75f7espy0zpzl8zwgzrs0pcat9c
tb1qeqql0ehsq7dqjztqjylf3tjwnzsc4uvxe9zra7
tb1qg34fr96ysy52feflhy894r0vax9wnpgqlw6jnj
tb1qcjlnn6dch35huwg86rg6usgqptl6pnhlnujthx
tb1qv43fay4ekrracew47cf4kxlqnht3elj07grvrh
tb1qr7lzyqwz3hy0whw5g070e3ss03kdcztqyh3hw7
tb1qazxwj8gxmpm8v56q2nt3suahrrnjr52ae9vtpa
tb1qc9zphyc3ytm7pgf9th4zwlrzyaynp8lwfv9y96
tb1qa6nkma5q4l3ksntjy0qtuxk3y6e3lrg6hpf4wy
tb1qtcyxuf4y8ygez52cc3gvgy38dp344w48kuutv8
tb1qflk3mrzadw9x54q9u56yezut2np3yr0f3j7gry
tb1qs68qmujm6sps63td6lnls7gpke07d98s5a2c2a
tb1qplyrx6lcqsauzhakhkd6m6ac9tr9r7p82z2fgv
tb1qj4alansrvzzmk8n8yamud8z4d7k5aneklwzny2
tb1q9fcf6gqf4w8t5gyateq9x5p495fllemehdz5v8
tb1q6l5fecla6nzqszf3ls8pzp29l37qzarrds3rue
tb1qltdqkgwxydt52v5t34s756x66m5k2wsvq5mqdv
n4PLRwPMjoYdQpYqiWqWDffVUe2PKDectr
```

## All beacon addresses per scenario

### 01-k1-base

- **DID:** `did:btcr2:k1qsprrscrk9fsazdegjtc7p6lups88ms3ee2hq2afaycvnmvqt2p9y9qatcxd5`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mouUUJ2yiKxkaXHezTZhY8QPq9dGyLjCLW`
  - `initialP2WPKH` (SingletonBeacon): `tb1qtsp4372zny669pa78ckr0lm0qfvk85te9qf3q4`
  - `initialP2TR` (SingletonBeacon): `tb1p5ugvzj9c5atz5q6qd982anhljp0wvkg456yg2r2x6alpkfd4ae7qfd0q2y`

### 02-k1-sidecar-update

- **DID:** `did:btcr2:k1qspz5wepjwqgtcg5e9qasyvmwhy9fdd6sdx8pz89zu4hcqeacz9s62s8rp8r9`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mqPxvdqG4K6fBA7zXtHUg6u7bYAHZcQHF2`
  - `initialP2WPKH` (SingletonBeacon): `tb1qd30d7cc8sx7m3k2amy9k3tx07nc50q68ruhhl2`
  - `initialP2TR` (SingletonBeacon): `tb1p6f6uf6n3603r5au38rmcrytsthsszp5rfagw0pkp8k7fnw6yehtq6qkl6c`
- Anchors:
  - update 1 at `initialP2PKH` (p2pkh, key genesis): `mqPxvdqG4K6fBA7zXtHUg6u7bYAHZcQHF2`

### 03-x1-base

- **DID:** `did:btcr2:x1qsv3urwdx8pnx52shpvqjnmg7rxsrngh95h85ef0n4e6xuzxkqptx2ga3aq`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `n3KBGNoSF5Q6rfhjdP2iw4gXUx2jrMJJLx`
  - `initialP2WPKH` (SingletonBeacon): `tb1qauvf572u6g6c032su297exwed5vtcq8ephn4jp`
  - `initialP2TR` (SingletonBeacon): `tb1pn0d56w34s473afq958s6j2rz4h9lv8mv24czyhzr6p3jtylsymqquf5t5h`

### 04-x1-sidecar-update

- **DID:** `did:btcr2:x1q359fq2nww7hgypedz5qnfmylanzw2p62z7lzm8agctugthkgp9uwprq8hr`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mhmrBVeeqjFcraMuQFiuTQQpqvTFYxrjVb`
  - `initialP2WPKH` (SingletonBeacon): `tb1qrrqkx4k0wpx3msug6hljr0wu9gxa747gv3pexd`
  - `initialP2TR` (SingletonBeacon): `tb1pcdql6zrymmeyez44s06eej6utlzx9wyzgl0sujptge60qwl6h34qn5p4ps`
- Anchors:
  - update 1 at `initialP2PKH` (p2pkh, key genesis): `mhmrBVeeqjFcraMuQFiuTQQpqvTFYxrjVb`

### 05-x1-no-beacon

- **DID:** `did:btcr2:x1qnh3j3xa57gnf6lkshvztp4tngeqhsy3n7qhfc9n995ww99q6ne2qyr97z7`
- _(no beacon services in this DID document)_

### 06-x1-cas-3-updates

- **DID:** `did:btcr2:x1qjdupajytz9csrtz3tjnaql06tg7jq80yv45vj36kj70pmf7ycz0z9js25l`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mg5c8JohW2tTj7CAHE3EfoQkACpr9FaNVY`
  - `initialP2WPKH` (SingletonBeacon): `tb1qqckwgtxtctqavkh26etymy9e6rcm3ngt76jyh7`
  - `initialP2TR` (SingletonBeacon): `tb1ppx4nfwaplr642nnxe3tzv2lptp0khzsq37srxerxcx4a8mj8jezsht3qsj`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1qqckwgtxtctqavkh26etymy9e6rcm3ngt76jyh7`
  - update 2 at `initialP2WPKH` (p2wpkh, key genesis): `tb1qqckwgtxtctqavkh26etymy9e6rcm3ngt76jyh7`
  - update 3 at `initialP2WPKH` (p2wpkh, key genesis): `tb1qqckwgtxtctqavkh26etymy9e6rcm3ngt76jyh7`

### 07-k1-sidecar-deactivate

- **DID:** `did:btcr2:k1qsps5avmw05fjke7jz2dvufdmntzetrxnk4q6t0qfdmhm7hz0ttljpge237ae`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mkvpLbfg5Xk8YSkWHSJaaYHij3Qqi1XENh`
  - `initialP2WPKH` (SingletonBeacon): `tb1q8ddlsa5k6va2gw7akkw3wwfjr0cmkhrejpxa5z`
  - `initialP2TR` (SingletonBeacon): `tb1pyd0mmy5k8z6l9deafnp74v2y9ql7c0qsh5zdwpl5d885g57p0taqxeaqfx`
- Anchors:
  - update 1 at `initialP2PKH` (p2pkh, key genesis): `mkvpLbfg5Xk8YSkWHSJaaYHij3Qqi1XENh`

### 08-x1-cas-update-deactivate

- **DID:** `did:btcr2:x1q37ws22m4c04rze3d9vn4rkt2tzd6h5k9z74a229gjd4mp9z6gqt2c7hlvp`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `n49dTYuqrBYbuPmh5PnUxBgURV7dAYBfXb`
  - `initialP2WPKH` (SingletonBeacon): `tb1qlppx7g0m9s4jdr4k57e6m5llwtel287cseda8s`
  - `initialP2TR` (SingletonBeacon): `tb1p39xfnknswa59kk0q0hs39zjzwrrnqqjpt4r5v62hedzjgkcpe6wqnnjfns`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1qlppx7g0m9s4jdr4k57e6m5llwtel287cseda8s`
  - update 2 at `initialP2WPKH` (p2wpkh, key genesis): `tb1qlppx7g0m9s4jdr4k57e6m5llwtel287cseda8s`

### 09a-x1-cas-update-announcement

- **DID:** `did:btcr2:x1qjg3rvgledjrugvv0snk7xg80chyywfpyfss27pw99h5kug03u46qnmqqy6`
- **Cohort:** cas-09
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `n3jkVydZ8u2Hh6HYPryrD6cBn7uepne6qV`
  - `initialP2WPKH` (SingletonBeacon): `tb1q7wl9gj0eqjfxygv82q4zt02u4vxk22stz4c04r`
  - `initialP2TR` (SingletonBeacon): `tb1pdmqwq6tc9jm8jtnjeu4nqywzmx94msem2szz6m2xmtnlxadyvemqztj5vs`
  - `cohortBeacon` (CASBeacon): `tb1qef7ssyzssusktlzx7jk6vhvsucn28u8xppl5w9`

### 09b-x1-cas-update-announcement-paired

- **DID:** `did:btcr2:x1qny5xjfv5cl4veelkpvrdv2qjrwxh6mzdqdwvak90adymzh79pmdskwad2c`
- **Cohort:** cas-09
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mjb4mgt1AZ79FPA32UTA37UqRy9kRcEgzF`
  - `initialP2WPKH` (SingletonBeacon): `tb1q9jne9sxv2u3dsf4kq6c7sd80nx7fu4fs4amulj`
  - `initialP2TR` (SingletonBeacon): `tb1p2gna3gqezdnhk0drp6v469pkeq0xphnvdmmmay6929pp4rzv7s3sz94elk`
  - `cohortBeacon` (CASBeacon): `tb1qef7ssyzssusktlzx7jk6vhvsucn28u8xppl5w9`

### 10a-x1-sidecar-update-cas-announcement

- **DID:** `did:btcr2:x1q3zsv63l5vv7rfejlk7smxjpanr8djjnszejcj3lvsl77sk4fp6fq37kkel`
- **Cohort:** cas-10
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mnP9QhnL9vxzamYJcm7PeSHWPJLVUCJSbi`
  - `initialP2WPKH` (SingletonBeacon): `tb1qfd8dfvwt7ydnrzwn47wcp3ulyqkwjark690ys2`
  - `initialP2TR` (SingletonBeacon): `tb1pf8ssmurtwx7cwwz4chhrky3k7l9hkxsun09v6mj4cftqha7rhezqznnn5d`
  - `cohortBeacon` (CASBeacon): `tb1qsstmwrwhvltfvkqd8csqj5dp862phwwwcjav4n`

### 10b-x1-sidecar-update-cas-announcement-paired

- **DID:** `did:btcr2:x1qs7clm0nsmwxdw9a57efe924u4pk7zl93p8g8eekfwp5cfrcap4ry9k605a`
- **Cohort:** cas-10
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mitvrSvjzAZ8cUfQiibiUVCeBbBuLTidJa`
  - `initialP2WPKH` (SingletonBeacon): `tb1qy5g9xsvg9td7asz6l3jclsyn9j585x4uz7p5ad`
  - `initialP2TR` (SingletonBeacon): `tb1pkcj5c885rvpuc5gkss4kkjl2fmn0l79j2uqhaj4ars9a2d77e2ese7vwm2`
  - `cohortBeacon` (CASBeacon): `tb1qsstmwrwhvltfvkqd8csqj5dp862phwwwcjav4n`

### 13-k1-update-p2wpkh

- **DID:** `did:btcr2:k1qspxpjr0xd97l92kqrh8pl4pjgjqvdxr6pyaxxqyr7g0t9h648kct5q7uqvsz`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mgapKLLRMpENAqvLg63Gp4RAN4EpqyLWWs`
  - `initialP2WPKH` (SingletonBeacon): `tb1qpwejz3erq0ls69acxl5sz2r9n9ytp7ntqu36qa`
  - `initialP2TR` (SingletonBeacon): `tb1p6zlpl3syg2jxr9ss0qjq9svcnxv3u6ktyc20gxujq7yf5teezw7srrpxy7`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1qpwejz3erq0ls69acxl5sz2r9n9ytp7ntqu36qa`

### 14-k1-update-p2tr

- **DID:** `did:btcr2:k1qspaj3wh7ztzvtw8qgcq0jm7dw2d44xp0k9397x0zkyewq0jr7r4crgefh3q4`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `n2NwSNrsFLnUrJfPxGALqzZbqhrL8YDc6r`
  - `initialP2WPKH` (SingletonBeacon): `tb1quntfjj6yxagwvvalc5qumj2n97umclcwtzmz0f`
  - `initialP2TR` (SingletonBeacon): `tb1px733ygvcrxjyydlmx7hfq7tve7llx295nvm6369fz03y3qlgpqdqczh893`
- Anchors:
  - update 1 at `initialP2TR` (p2tr, key genesis): `tb1px733ygvcrxjyydlmx7hfq7tve7llx295nvm6369fz03y3qlgpqdqczh893`

### 15-x1-beacon-rotation

- **DID:** `did:btcr2:x1qnenf7q8f07k6qq30xx6qez6laurmqes9cjpezjshpj4mw8aaaknc7azjf6`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mpqbg2M3FCEFbvB6X8rJegTbdD4DD7JoHW`
  - `initialP2WPKH` (SingletonBeacon): `tb1qvclay4ga48hpzyztqjqphatz4zd2k22g2a633v`
  - `initialP2TR` (SingletonBeacon): `tb1pdkwpz80jdm3wfa4jmg5ek0wkd2vnpfpdyc64p607mdp32xvzq04setf7qv`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1qvclay4ga48hpzyztqjqphatz4zd2k22g2a633v`
  - update 2 at `initialP2PKH` (p2pkh, key rotated): `mwtgHduMEgj9xkqAfwRnWM3QL4vnz3gfQx`

### 16-x1-beacon-add-then-use

- **DID:** `did:btcr2:x1qsvpyve87n97xm7mxswheuwegmyd9naefzk7s6kspt6cq46az3jk7tfsg32`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mxvYKYioAoBcF6N2e1ADXEqxHgkP2daHwc`
  - `initialP2WPKH` (SingletonBeacon): `tb1qhmcph49wsq7hgmpfmpdtwx298mps3hdjykxhfp`
  - `initialP2TR` (SingletonBeacon): `tb1p843hae6yvmq2lzj60dmhe75suwq7ynqlnnv5y4uu5dzavpsmlr3q8z4rlz`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1qhmcph49wsq7hgmpfmpdtwx298mps3hdjykxhfp`
  - update 2 at `newBeacon` (p2wpkh, key newBeacon): `tb1qathq9ct9zfjchxzv0v8jv55dfrj7jcxvg6g79c`

### 17-x1-vm-add-rotate-authentication

- **DID:** `did:btcr2:x1qsukh94mtqxv5e72hh2rhmyutu3jfcypvrr4m2p3mpe38k0328rcxxhleny`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mx5iMzt4kp9M8aBHaBU9SNAyfbYijF56Y2`
  - `initialP2WPKH` (SingletonBeacon): `tb1qkk6pcprxxnhyc3ruhrsd8v0yczzjxcrak995dp`
  - `initialP2TR` (SingletonBeacon): `tb1pe0jj3ymqsnj52nx3cjkqhmx0h6cjavwzjw3mze4vxeesra5z7zwq38k4y7`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1qkk6pcprxxnhyc3ruhrsd8v0yczzjxcrak995dp`
  - update 2 at `initialP2WPKH` (p2wpkh, key genesis): `tb1qkk6pcprxxnhyc3ruhrsd8v0yczzjxcrak995dp`

### 18-x1-embedded-invocation-key

- **DID:** `did:btcr2:x1qjmhfkyxuvj5el2wsvkx6cyp8k4luhqxxwt85egq8rlzhke6ys4026ck7ml`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mwupEXhGyTS8hpZqJXK9k34ZnqyjDVcTpA`
  - `initialP2WPKH` (SingletonBeacon): `tb1qk02dn5eek4p4sx8n6rg2lna8pt4lharxdsknmt`
  - `initialP2TR` (SingletonBeacon): `tb1pmrd8hnle33kcqfuwxgndzqkhc8w9k6zf3hzv8j6y40lwy7nfsjzslq6dmw`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1qk02dn5eek4p4sx8n6rg2lna8pt4lharxdsknmt`

### 19-x1-relative-ids

- **DID:** `did:btcr2:x1qjszxrzdu5j2pm6ay24q8qkypcxp27y0j6kze9q4uj37mdqq8jdrk8kkgfz`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mxzxCYUQjMKuT2EnEMijBFr4aya8G9fff2`
  - `initialP2WPKH` (SingletonBeacon): `tb1qhlzmfw9luplp7rxqxualfrfuuyx79up62eym3q`
  - `initialP2TR` (SingletonBeacon): `tb1ppt2r9v0hv5pzljrxn34a8aj8w9j6t73wh8dfrzrwnnn4jky52jaquykc38`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1qhlzmfw9luplp7rxqxualfrfuuyx79up62eym3q`

### 20-k1-cas-update

- **DID:** `did:btcr2:k1qsprptnrrmlzjwadmqem204tgftcsulu3n70hpgavqrma6tlta5g39sgw566g`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mwJQ8xPb3rRGvZqP3u7dmS17dnS8r2nCaJ`
  - `initialP2WPKH` (SingletonBeacon): `tb1q453zmpzqt7ypnxv9tx6mgf5fclakew4qrvz5s8`
  - `initialP2TR` (SingletonBeacon): `tb1pj9y0un7ulmzsp42j3v2u8gn0sszv4yyl96ngcer5yqjuc80p7k8qa6p0lz`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1q453zmpzqt7ypnxv9tx6mgf5fclakew4qrvz5s8`

### 21-k1-deactivate-then-update

- **DID:** `did:btcr2:k1qsp472vc5tgquf0hfns4x9cnt0h2jqvgdjftufqy5ar0k7cu32xanwsuacycj`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mvgq8Jkjn9jx93MiHF1JQRERzj4GXzdnog`
  - `initialP2WPKH` (SingletonBeacon): `tb1q5e5pqy4t0lfkvkn5rtlws6vssnc4dsg88fltlk`
  - `initialP2TR` (SingletonBeacon): `tb1pu026h5v9q3qfkxk872gyg376v3chmw9ldfps3n9m3vqua4gnwjqsfjldrz`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1q5e5pqy4t0lfkvkn5rtlws6vssnc4dsg88fltlk`
  - update 2 at `initialP2WPKH` (p2wpkh, key genesis): `tb1q5e5pqy4t0lfkvkn5rtlws6vssnc4dsg88fltlk`

### 22-x1-three-updates-resolution-options

- **DID:** `did:btcr2:x1qsryv830c4av869cfpl2mz87zzk28uv4ylkn3cntzahfu0xdnvtyg66nlz7`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mfXc1Fi7knf45qpvDG27KbxvVHjmttcEiG`
  - `initialP2WPKH` (SingletonBeacon): `tb1qqq0h4gxsr2aepshkzll8c47ekmpq853d4yv7fa`
  - `initialP2TR` (SingletonBeacon): `tb1pd8dx93vkkgnz6evrvs22rtnpetuhg4xq5gj4mkf4dp8mf7nylkvsgzdwfj`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1qqq0h4gxsr2aepshkzll8c47ekmpq853d4yv7fa`
  - update 2 at `initialP2WPKH` (p2wpkh, key genesis): `tb1qqq0h4gxsr2aepshkzll8c47ekmpq853d4yv7fa`
  - update 3 at `initialP2WPKH` (p2wpkh, key genesis): `tb1qqq0h4gxsr2aepshkzll8c47ekmpq853d4yv7fa`

### 23-k1-duplicate-signal

- **DID:** `did:btcr2:k1qspm6rmqtrv03wvjz6hung7wnf4vrhjqgcuhv3hy3920a2t8fjqh3ssedy3nn`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mzASWnEFHY8XLrL2nQdZGoRS7vrgb5rYjp`
  - `initialP2WPKH` (SingletonBeacon): `tb1qejynvzv27lm3fx50rsp6psdkvgczurr8qypu20`
  - `initialP2TR` (SingletonBeacon): `tb1py5ung5hpz27ma5zzydp3s7hpaftrqjz60v7x9kquxq3wd5ffmvaswsj4d8`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1qejynvzv27lm3fx50rsp6psdkvgczurr8qypu20`
  - update 2 at `initialP2WPKH` (p2wpkh, key genesis): `tb1qejynvzv27lm3fx50rsp6psdkvgczurr8qypu20`
  - update 3 at `initialP2WPKH` (p2wpkh, key genesis): `tb1qejynvzv27lm3fx50rsp6psdkvgczurr8qypu20`

### 24-k1-removed-beacon-signal

- **DID:** `did:btcr2:k1qspqm6j2u5pe5s4ucchgs63cdmmyprh8vahc2tq0x8l0rm0zytqd2wqvld589`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `n3e8JLp9wvkgqNfC1yGyL2eYSRYxqK9Rnp`
  - `initialP2WPKH` (SingletonBeacon): `tb1q72hq0hzexmutcclhgqrmkj9xz8a5z65e7mhvev`
  - `initialP2TR` (SingletonBeacon): `tb1pcpwpkzd4lqnppnqtrluwdjjdnucn4cyutmffxauyfnk2pd2nuczss37gny`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1q72hq0hzexmutcclhgqrmkj9xz8a5z65e7mhvev`
  - update 2 at `initialP2PKH` (p2pkh, key genesis): `n3e8JLp9wvkgqNfC1yGyL2eYSRYxqK9Rnp`

### n01-k1-invalid-did-checksum

- **DID:** `did:btcr2:k1qspg7yhraawy4kdd7denm4kp8prhqhc57xzf9r84vp6936fk9wufddcvlhpww`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mxVmD8jUXegsXevUGfrEYiwHED7vwmTzsn`
  - `initialP2WPKH` (SingletonBeacon): `tb1qhfq8s85fteu828erzu80rvhtmg6th6x77kr2k4`
  - `initialP2TR` (SingletonBeacon): `tb1p3am9ghtly9ke2f6enwv8kqz3a5ne5fpp25mta3ml44505cn03n2qsg683h`

### n02-x1-invalid-did-padding

- **DID:** `did:btcr2:x1qjkr5uknj298edvf46n4y9jskf5w02wwc7lz9vvw5twpssflz8khchjwd5e`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `muFc1Ze92rbwETv35YiTZGgNktnPpWaTyq`
  - `initialP2WPKH` (SingletonBeacon): `tb1qj64fdjlanpa6hgf27g3lsywx3kjerg4vufrlhs`
  - `initialP2TR` (SingletonBeacon): `tb1pzha32lxrest7zu2q03vyv7vmq0kq6tlcttxwgft4uxmy3c0pt6vs95flpw`

### n03-k1-invalid-did-network-nibble

- **DID:** `did:btcr2:k1qsp9e042jyjqen2gv8tncj2uh0jjn09txlc7qu070272m6y5usanyxg3nlhe0`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mudiTuD1cTXCWNUpAPdebejDBG87vm65Br`
  - `initialP2WPKH` (SingletonBeacon): `tb1qntvjpwrnkzk6fzllq2cfgepkc0kmsqkv0se599`
  - `initialP2TR` (SingletonBeacon): `tb1pj0pup9fc6rzff3lnnhypl26fffzv7keschmn0pcjlrk8cd7clnzqt7rkfs`

### n04-x1-genesis-hash-mismatch

- **DID:** `did:btcr2:x1qnr6s8cg0ljl9ql252jqezvh6rv3thgav37grw5xa0ehpx6gheycwhgxuh0`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mm53gM9PY7wK1iQxVVzKiC4SrzZGRcARmS`
  - `initialP2WPKH` (SingletonBeacon): `tb1q8n4x7vdxq8ak20p0ks5yeyv23qwqtk9yenqrgv`
  - `initialP2TR` (SingletonBeacon): `tb1p3k5e4g8ntkm6cg0gmjx3xjrl4nhjtujnu7lvj9mdqcw90t3q246svvag3m`

### n05-x1-missing-update-data

- **DID:** `did:btcr2:x1qnwp673eqen450mtqs0yd6egjmav324764eqpzdsdnxyspnyq4f4xpmfeem`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `miLJw4vb7ctvM2UwE48D9a1JPPCCdb5phN`
  - `initialP2WPKH` (SingletonBeacon): `tb1qrmjs09uhnshva596ngd6h22yuz8vupd7tnvddn`
  - `initialP2TR` (SingletonBeacon): `tb1pnfet8shafn4mt6nxk9h4wah55kr4mk54c5tau7ss8pcaajrkxgvse4nmu4`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1qrmjs09uhnshva596ngd6h22yuz8vupd7tnvddn`

### n10-k1-invalid-update-context-member

- **DID:** `did:btcr2:k1qsp3k0pqt3ekmdfs88cdajc435rw0xyfhxlwhtk2nuqs5vx3kj00s9s35fkkz`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mrXtJ9wZ5b9GcJJar5XF1pLBtXuc37YgUW`
  - `initialP2WPKH` (SingletonBeacon): `tb1q0rt8v302ruzz3m4f0yrf3sl2ntlnamzc9ysa0k`
  - `initialP2TR` (SingletonBeacon): `tb1p3dtqe20mfgj6g7a2qjnc9nw27cjykn4tntmhludtaxquty8wg2ys78uy6k`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1q0rt8v302ruzz3m4f0yrf3sl2ntlnamzc9ysa0k`

### n11-k1-invalid-update-context-order

- **DID:** `did:btcr2:k1qsp854zkyhp323d7nj7q5xxqqw2wv6mvngl2pwjlcz0muqm98ezkllgwu8zuu`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mvefRVWFLrsqvxys8JqXeCFvy6fSd5DbuW`
  - `initialP2WPKH` (SingletonBeacon): `tb1q5hljzuzt92rtx9jc9lpe9yuln56ps4qud4x2t5`
  - `initialP2TR` (SingletonBeacon): `tb1pfthh6p93msuym94j2ftqsewpwqs8xs3s080lgla83azs92c8fslsjg6yn5`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1q5hljzuzt92rtx9jc9lpe9yuln56ps4qud4x2t5`

### n12-k1-invalid-update-proof-context

- **DID:** `did:btcr2:k1qsptz2u92e9089ll4hrcf4mez5esraut4kgg2qt3su46e4phsugtuqc4lt579`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mzqiirv3evxxPf3zUAaPY3yCs4FWSrhqBD`
  - `initialP2WPKH` (SingletonBeacon): `tb1q60m0dt03clz75f7espy0zpzl8zwgzrs0pcat9c`
  - `initialP2TR` (SingletonBeacon): `tb1pl00xtj476c4yp0mt4cjvhlqpq89eg4ezrvuyylm2zv0d7u85tukqrs55sl`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1q60m0dt03clz75f7espy0zpzl8zwgzrs0pcat9c`

### n13-k1-invalid-update-capability-action

- **DID:** `did:btcr2:k1qspmajv6k52vl8p8nag7nvnz8f62we39xftn5nxuzl3x7t7rdrddsgshzjej7`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mykVoBfXKmB5QsjVU234NEtN6hVHNTeMj3`
  - `initialP2WPKH` (SingletonBeacon): `tb1qeqql0ehsq7dqjztqjylf3tjwnzsc4uvxe9zra7`
  - `initialP2TR` (SingletonBeacon): `tb1p95v9qrd9g26r8rmal44arpt5s97m8kp5ru34zkk0y0gxacknpnpqamq0fm`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1qeqql0ehsq7dqjztqjylf3tjwnzsc4uvxe9zra7`

### n14-k1-invalid-update-capability-encoding

- **DID:** `did:btcr2:k1qsp9820e6rhygl2hs7a755nt3v0yh9xlkes77p9jttfyp3me5c2ters6t49xh`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mmkhud4bsNpgfgkVZ4ydz5cHQksyu7iy8r`
  - `initialP2WPKH` (SingletonBeacon): `tb1qg34fr96ysy52feflhy894r0vax9wnpgqlw6jnj`
  - `initialP2TR` (SingletonBeacon): `tb1p0uq0ad60m66r5crxahx532qsrhpy8x93d4pgqhgf8r60qjjdxynsju2nzn`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1qg34fr96ysy52feflhy894r0vax9wnpgqlw6jnj`

### n15-k1-invalid-update-proof-purpose

- **DID:** `did:btcr2:k1qspqqxgvhgwj4esjjr8yhv2hkg58npda9x67lxye5thzhp4xprffd6szgj2my`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `myTFpHQUY8hGnrqzmzgQ9xZECNoW73p4d8`
  - `initialP2WPKH` (SingletonBeacon): `tb1qcjlnn6dch35huwg86rg6usgqptl6pnhlnujthx`
  - `initialP2TR` (SingletonBeacon): `tb1ptlhyelh653kq93p3lejhzlk25eu3qjgjkn93dupkve2z2t57gqus4gvk5n`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1qcjlnn6dch35huwg86rg6usgqptl6pnhlnujthx`

### n16-x1-invalid-update-unauthorized-method

- **DID:** `did:btcr2:x1qjw0t0e45uc8mtq2mwk45rv734yn3a6kxr6xtxwrrya5dswr8c6jjgl9qc8`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mpm2gdJgihVqj7qwnchEWXSv5iUmYK5jCV`
  - `initialP2WPKH` (SingletonBeacon): `tb1qv43fay4ekrracew47cf4kxlqnht3elj07grvrh`
  - `initialP2TR` (SingletonBeacon): `tb1pzu5an598nvt8zdv04wc5q8frqrjvav6vnddsfw0rcwrpre9cp8zqs9frcd`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1qv43fay4ekrracew47cf4kxlqnht3elj07grvrh`

### n17-k1-invalid-update-unknown-method

- **DID:** `did:btcr2:k1qsp2x3482yltp0mgjtw0sc7jvpnwm3twq7xc93ljg66vt390hmfzj3qu37euy`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `miQo1fMMnEYh5c3hWWD2g7mVsGm7Vk74VR`
  - `initialP2WPKH` (SingletonBeacon): `tb1qr7lzyqwz3hy0whw5g070e3ss03kdcztqyh3hw7`
  - `initialP2TR` (SingletonBeacon): `tb1pwas6dn3mhnm99wzw92u3twpfxe5yx6zcv4xpagfakhpygvf2h9lqtkdrd2`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1qr7lzyqwz3hy0whw5g070e3ss03kdcztqyh3hw7`

### n18-k1-invalid-update-proof-value

- **DID:** `did:btcr2:k1qspq6yml7hpze5fpwy6xwt29tx74jev9nesfd67shhdha9r0rjxcd3cwx62he`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `n2iZsCUr79vkHmcGJs94euKjkAEA8FZLHL`
  - `initialP2WPKH` (SingletonBeacon): `tb1qazxwj8gxmpm8v56q2nt3suahrrnjr52ae9vtpa`
  - `initialP2TR` (SingletonBeacon): `tb1pycslkdk8gwe3a96ttn02uwzp3sf9mt5tw5e4rza3j9ze5pj423tsue0adg`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1qazxwj8gxmpm8v56q2nt3suahrrnjr52ae9vtpa`

### n19-k1-invalid-update-source-hash

- **DID:** `did:btcr2:k1qspk7udktxfk8xz6uvlp5mxw27ljuaf4fh7r2gyd906lrmk6ct6206scq4s7d`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `my8rJHS6gFnErn7zFu8uQ51eLCPttZhyou`
  - `initialP2WPKH` (SingletonBeacon): `tb1qc9zphyc3ytm7pgf9th4zwlrzyaynp8lwfv9y96`
  - `initialP2TR` (SingletonBeacon): `tb1psp0yma08j0l5m8xejchqkmq9usguf3h4ch393s50l2txfzyhwhjqyywns9`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1qc9zphyc3ytm7pgf9th4zwlrzyaynp8lwfv9y96`

### n20-k1-invalid-update-target-hash

- **DID:** `did:btcr2:k1qspqn9946vnm3n0g3rc4p84apvfx6s06w8av363dxk4g9k7cnmkvg2qd5dg3k`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `n3GqgvDA4SZXqg5NqpoL7N33yufr1e5Cna`
  - `initialP2WPKH` (SingletonBeacon): `tb1qa6nkma5q4l3ksntjy0qtuxk3y6e3lrg6hpf4wy`
  - `initialP2TR` (SingletonBeacon): `tb1pj9m2j6kzp20nc6tlquwva74u7vgyywusfs5cm7320t9vmemhx6mqql52ke`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1qa6nkma5q4l3ksntjy0qtuxk3y6e3lrg6hpf4wy`

### n21-k1-invalid-update-version-skip

- **DID:** `did:btcr2:k1qspmsf53fsyt4f0t49pysgsr3vqqcqevf7jmajgtp4wjjcj60v2xx3s943yup`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mp69uqD7aTX6E3wiuGoBREgoRvPdNryQz8`
  - `initialP2WPKH` (SingletonBeacon): `tb1qtcyxuf4y8ygez52cc3gvgy38dp344w48kuutv8`
  - `initialP2TR` (SingletonBeacon): `tb1p3m7d5xd95ug7u7zjq4mg9mftu0xzjy040sun3l5pxf4xdmy5e9asz8fg5t`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1qtcyxuf4y8ygez52cc3gvgy38dp344w48kuutv8`

### n22-k1-invalid-update-patch-missing-path

- **DID:** `did:btcr2:k1qsp622hdjxe7jmme89k8p8dnv5pqepjlg4u9pq6glu7ags6hegf99lqnxr08r`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mnoZjH2ETRTwBMWViRxLfbUq7ovd4aj8KQ`
  - `initialP2WPKH` (SingletonBeacon): `tb1qflk3mrzadw9x54q9u56yezut2np3yr0f3j7gry`
  - `initialP2TR` (SingletonBeacon): `tb1pwlq8aj6ysx9p9z4v5z5dp9celmvm3ht8z0tcjfsp0f3uexfrnc8qjfyuuw`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1qflk3mrzadw9x54q9u56yezut2np3yr0f3j7gry`

### n23-k1-invalid-update-patch-changes-id

- **DID:** `did:btcr2:k1qspzu0kw9ufrz5xh8y36felcd2cch0lgppfdrgjslxynv22syt4ydlg4x5c0z`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `msnR1srMd9Zjozyex7F91hEPar3RuhDt41`
  - `initialP2WPKH` (SingletonBeacon): `tb1qs68qmujm6sps63td6lnls7gpke07d98s5a2c2a`
  - `initialP2TR` (SingletonBeacon): `tb1pxtzu48x2k73lmwzzfpnhsjmdgp7hw6sltdkeytzg0g8pjhlws2yswwrqp3`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1qs68qmujm6sps63td6lnls7gpke07d98s5a2c2a`

### n24-k1-invalid-update-patch-invalid-document

- **DID:** `did:btcr2:k1qspf02mvzrlsu7shtf6cxvpqk0enehdk3xm89lqv5w8q9rn0enkqynqt8ss0t`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mgxQG8ahi8ia1o8bvrekgBYSJRAhdTNPr1`
  - `initialP2WPKH` (SingletonBeacon): `tb1qplyrx6lcqsauzhakhkd6m6ac9tr9r7p82z2fgv`
  - `initialP2TR` (SingletonBeacon): `tb1pga4x6330kvyu9c4czvw7vxy8ep8tpz6afryxdyxzh292hmjllxdsx6dgsz`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1qplyrx6lcqsauzhakhkd6m6ac9tr9r7p82z2fgv`

### n25-k1-invalid-update-created-after-block

- **DID:** `did:btcr2:k1qsp8g0tw80tkzl5nu2fwsn2qdetjr5nk9qfxjkzj70ccvmwg0rpl6eqznzpu2`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mu9MWyzNjotwAqJXWAU4RyQo2E4rSwDoem`
  - `initialP2WPKH` (SingletonBeacon): `tb1qj4alansrvzzmk8n8yamud8z4d7k5aneklwzny2`
  - `initialP2TR` (SingletonBeacon): `tb1peaw6atq4h0ttqfltz6hhxtwnf8rmjp7eryg7fgypatjvl5ewn4tqem7qeq`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1qj4alansrvzzmk8n8yamud8z4d7k5aneklwzny2`

### n26-k1-invalid-update-expires-before-mediantime

- **DID:** `did:btcr2:k1qspxna3u5peke5rgl7xf5ay5yz6u6rs58y349syxp924hdawzgy8yhg57na58`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `mjPMaepLWkgurK5JM37c6jj9Qc6V4mnLXp`
  - `initialP2WPKH` (SingletonBeacon): `tb1q9fcf6gqf4w8t5gyateq9x5p495fllemehdz5v8`
  - `initialP2TR` (SingletonBeacon): `tb1putg40hftyunfxk4eqwszduru9kscewer0nx5fvlpyv2lf9et8pps7yz4y3`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1q9fcf6gqf4w8t5gyateq9x5p495fllemehdz5v8`

### n27-k1-invalid-update-expires-before-created

- **DID:** `did:btcr2:k1qspurjp50njc35xxkaumgfepukhxjjevq89fpfg56r5vazef7w6m5ggczsfff`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `n1CaEXEERaq6E8WzC7wYBHsfzGEEy4dvzq`
  - `initialP2WPKH` (SingletonBeacon): `tb1q6l5fecla6nzqszf3ls8pzp29l37qzarrds3rue`
  - `initialP2TR` (SingletonBeacon): `tb1p55ygke78skyktjgc2y948ssluhf85uxz7qcyac03kxtzhnptmtgqdz8jrv`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1q6l5fecla6nzqszf3ls8pzp29l37qzarrds3rue`

### n28-k1-late-publishing

- **DID:** `did:btcr2:k1qspe8u25mdzxgg6n34a9ryukjf6pfp3kez8nm6af4x48nz6k6wxqezg0j222a`
- Beacons:
  - `initialP2PKH` (SingletonBeacon): `n4PLRwPMjoYdQpYqiWqWDffVUe2PKDectr`
  - `initialP2WPKH` (SingletonBeacon): `tb1qltdqkgwxydt52v5t34s756x66m5k2wsvq5mqdv`
  - `initialP2TR` (SingletonBeacon): `tb1pt9a89llppaecwxm5el9rqy09d4tyxvhwq06sgpxjct63rjcs5wvqtd3wmj`
- Anchors:
  - update 1 at `initialP2WPKH` (p2wpkh, key genesis): `tb1qltdqkgwxydt52v5t34s756x66m5k2wsvq5mqdv`
  - update 2 at `initialP2PKH` (p2pkh, key genesis): `n4PLRwPMjoYdQpYqiWqWDffVUe2PKDectr`

