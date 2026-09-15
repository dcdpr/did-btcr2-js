# did:btcr2 Regtest Test Vectors

`did:btcr2` test vectors registered on a local regtest network. The state of that network is in `did-btcr2.polar.zip`.

## Connecting to the regtest network

1. Unzip `did-btcr2.polar.zip`.
2. Change directory into the extracted folder: `cd did-btcr2-electrs.polar`
3. Start the containers: `docker-compose up`
4. Make sure the network runs with electrs:
   - Open `http://localhost:3000/blocks` in a browser. The page shows a JSON list of blocks.
   - Or run `curl localhost:3000/blocks` in a terminal.

If you get `curl: (56) Recv failure: Connection reset by peer`, or the browser cannot open localhost:3000:

1. Make sure the containers run (step 3 above).
2. Find the bitcoind container id: `docker ps` and look for the `polarlightning` container.
3. Open a shell in that container: `docker exec -it <CONTAINER_ID> bash`
4. Mine 6 blocks:
   ```sh
   bitcoin-cli \
     -regtest \
     -rpcuser=polaruser \
     -rpcpassword=polarpass \
     generatetoaddress 6 \
     $(bitcoin-cli -regtest -rpcuser=polaruser -rpcpassword=polarpass getnewaddress)
   ```
5. Wait about 30 seconds for the sync, then do step 4 above again.

You can also drag the zip file into the [Lightning Polar](https://lightningpolar.com/) app and start the network from there. Polar may drop the electrs and ipfs parts of the compose file. If so, copy them from the `docker-compose.yml` in the zip into the Polar compose file (`~/.polar/networks`).

Configure your resolver to query the electrs API at `http://localhost:3000`. The Bitcoin Core RPC of the stack is `http://localhost:18443` (user `polaruser`, password `polarpass`).

The stack also runs a Kubo (IPFS) node. It holds every CAS object of the vectors: the genesis documents, the signed updates, and the CAS Announcement Maps that a scenario delivers out of band. The node runs offline, so it serves the pinned blocks only. Configure your resolver to read CAS objects from the gateway `http://127.0.0.1:8080` (`/ipfs/<cid>?format=raw`). The Kubo RPC API is `http://127.0.0.1:5001`.
