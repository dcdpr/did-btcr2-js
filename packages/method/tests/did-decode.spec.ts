import { bytesToHex } from '@noble/hashes/utils';
import { expect } from 'chai';
import { Identifier } from '../src/index.js';

describe('Identifier Encode', () => {
  const vectors = [
    {
      did        : 'did:btcr2:k1qqpvksjk8vfxpp0pl6jzwvc4sw7knmv8q4l2j5j2vgsjwfrfer2vqqqvgmw6r',
      components : {
        hrp          : 'k',
        idType       : 'KEY',
        version      : 1,
        network      : 'bitcoin',
        genesisBytes : '02cb42563b126085e1fea427331583bd69ed87057ea9524a6221272469c8d4c000'
      }
    },
    {
      did        : 'did:btcr2:k1q5pvksjk8vfxpp0pl6jzwvc4sw7knmv8q4l2j5j2vgsjwfrfer2vqqqcx5ksj',
      components : {
        hrp          : 'k',
        idType       : 'KEY',
        version      : 1,
        network      : 'mutinynet',
        genesisBytes : '02cb42563b126085e1fea427331583bd69ed87057ea9524a6221272469c8d4c000'
      }
    },
    {
      did        : 'did:btcr2:k1qgpvksjk8vfxpp0pl6jzwvc4sw7knmv8q4l2j5j2vgsjwfrfer2vqqqy7ae7f',
      components : {
        hrp          : 'k',
        idType       : 'KEY',
        version      : 1,
        network      : 'regtest',
        genesisBytes : '02cb42563b126085e1fea427331583bd69ed87057ea9524a6221272469c8d4c000'
      }
    },
    {
      did        : 'did:btcr2:k1qypvksjk8vfxpp0pl6jzwvc4sw7knmv8q4l2j5j2vgsjwfrfer2vqqqgrc3cx',
      components : {
        hrp          : 'k',
        idType       : 'KEY',
        version      : 1,
        network      : 'signet',
        genesisBytes : '02cb42563b126085e1fea427331583bd69ed87057ea9524a6221272469c8d4c000'
      }
    },
    {
      did        : 'did:btcr2:k1qvpvksjk8vfxpp0pl6jzwvc4sw7knmv8q4l2j5j2vgsjwfrfer2vqqqq47xuv',
      components : {
        hrp          : 'k',
        idType       : 'KEY',
        version      : 1,
        network      : 'testnet3',
        genesisBytes : '02cb42563b126085e1fea427331583bd69ed87057ea9524a6221272469c8d4c000'
      }
    },
    {
      did        : 'did:btcr2:k1qspvksjk8vfxpp0pl6jzwvc4sw7knmv8q4l2j5j2vgsjwfrfer2vqqqudhfjh',
      components : {
        hrp          : 'k',
        idType       : 'KEY',
        version      : 1,
        network      : 'testnet4',
        genesisBytes : '02cb42563b126085e1fea427331583bd69ed87057ea9524a6221272469c8d4c000'
      }
    },
    {
      did        : 'did:btcr2:x1qzlqmvawa6ya5fx4qyf27a85p34z07z060h352qxgl65fr6d4ugmzm5tzxq',
      components : {
        hrp          : 'x',
        idType       : 'EXTERNAL',
        version      : 1,
        network      : 'bitcoin',
        genesisBytes : 'be0db3aeee89da24d50112af74f40c6a27f84fd3ef1a280647f5448f4daf11b1'
      }
    },
    {
      did        : 'did:btcr2:x1qklqmvawa6ya5fx4qyf27a85p34z07z060h352qxgl65fr6d4ugmzjvc6fe',
      components : {
        hrp          : 'x',
        idType       : 'EXTERNAL',
        version      : 1,
        network      : 'mutinynet',
        genesisBytes : 'be0db3aeee89da24d50112af74f40c6a27f84fd3ef1a280647f5448f4daf11b1'
      }
    },
    {
      did        : 'did:btcr2:x1q2lqmvawa6ya5fx4qyf27a85p34z07z060h352qxgl65fr6d4ugmzxrg4q8',
      components : {
        hrp          : 'x',
        idType       : 'EXTERNAL',
        version      : 1,
        network      : 'regtest',
        genesisBytes : 'be0db3aeee89da24d50112af74f40c6a27f84fd3ef1a280647f5448f4daf11b1'
      }
    },
    {
      did        : 'did:btcr2:x1qxlqmvawa6ya5fx4qyf27a85p34z07z060h352qxgl65fr6d4ugmzpt7a9h',
      components : {
        hrp          : 'x',
        idType       : 'EXTERNAL',
        version      : 1,
        network      : 'signet',
        genesisBytes : 'be0db3aeee89da24d50112af74f40c6a27f84fd3ef1a280647f5448f4daf11b1'
      }
    },
    {
      did        : 'did:btcr2:x1qwlqmvawa6ya5fx4qyf27a85p34z07z060h352qxgl65fr6d4ugmzuua2rs',
      components : {
        hrp          : 'x',
        idType       : 'EXTERNAL',
        version      : 1,
        network      : 'testnet3',
        genesisBytes : 'be0db3aeee89da24d50112af74f40c6a27f84fd3ef1a280647f5448f4daf11b1'
      }
    },
    {
      did        : 'did:btcr2:x1qjlqmvawa6ya5fx4qyf27a85p34z07z060h352qxgl65fr6d4ugmzgnd92w',
      components : {
        hrp          : 'x',
        idType       : 'EXTERNAL',
        version      : 1,
        network      : 'testnet4',
        genesisBytes : 'be0db3aeee89da24d50112af74f40c6a27f84fd3ef1a280647f5448f4daf11b1'
      }
    }
  ];

  it('should properly decode and match each vector', () => {
    vectors.map(({ did, components: { hrp, idType, version, network, genesisBytes } }) => {
      const decoded = Identifier.decode(did);
      expect(decoded.hrp).to.equal(hrp);
      expect(decoded.idType).to.equal(idType);
      expect(decoded.version).to.equal(version);
      expect(decoded.network).to.equal(network);
      expect(bytesToHex(decoded.genesisBytes)).to.equal(genesisBytes);
    });
  });
});