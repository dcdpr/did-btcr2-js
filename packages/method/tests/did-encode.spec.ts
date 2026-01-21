import { expect } from 'chai';
import { Identifier } from '../src/index.js';

const vectors = [
  {
    did        : 'did:btcr2:k1qqpvksjk8vfxpp0pl6jzwvc4sw7knmv8q4l2j5j2vgsjwfrfer2vqqqvgmw6r',
    components : {
      idType       : 'KEY',
      version      : 1,
      network      : 'bitcoin',
      genesisBytes : Buffer.from('02cb42563b126085e1fea427331583bd69ed87057ea9524a6221272469c8d4c000', 'hex')
    }
  },
  {
    did        : 'did:btcr2:k1q5pvksjk8vfxpp0pl6jzwvc4sw7knmv8q4l2j5j2vgsjwfrfer2vqqqcx5ksj',
    components : {
      idType       : 'KEY',
      version      : 1,
      network      : 'mutinynet',
      genesisBytes : Buffer.from('02cb42563b126085e1fea427331583bd69ed87057ea9524a6221272469c8d4c000', 'hex')
    }
  },
  {
    did        : 'did:btcr2:k1qgpvksjk8vfxpp0pl6jzwvc4sw7knmv8q4l2j5j2vgsjwfrfer2vqqqy7ae7f',
    components : {
      idType       : 'KEY',
      version      : 1,
      network      : 'regtest',
      genesisBytes : Buffer.from('02cb42563b126085e1fea427331583bd69ed87057ea9524a6221272469c8d4c000', 'hex')
    }
  },
  {
    did        : 'did:btcr2:k1qypvksjk8vfxpp0pl6jzwvc4sw7knmv8q4l2j5j2vgsjwfrfer2vqqqgrc3cx',
    components : {
      idType       : 'KEY',
      version      : 1,
      network      : 'signet',
      genesisBytes : Buffer.from('02cb42563b126085e1fea427331583bd69ed87057ea9524a6221272469c8d4c000', 'hex')
    }
  },
  {
    did        : 'did:btcr2:k1qvpvksjk8vfxpp0pl6jzwvc4sw7knmv8q4l2j5j2vgsjwfrfer2vqqqq47xuv',
    components : {
      idType       : 'KEY',
      version      : 1,
      network      : 'testnet3',
      genesisBytes : Buffer.from('02cb42563b126085e1fea427331583bd69ed87057ea9524a6221272469c8d4c000', 'hex')
    }
  },
  {
    did        : 'did:btcr2:k1qspvksjk8vfxpp0pl6jzwvc4sw7knmv8q4l2j5j2vgsjwfrfer2vqqqudhfjh',
    components : {
      idType       : 'KEY',
      version      : 1,
      network      : 'testnet4',
      genesisBytes : Buffer.from('02cb42563b126085e1fea427331583bd69ed87057ea9524a6221272469c8d4c000', 'hex')
    }
  },
  {
    did        : 'did:btcr2:x1qzlqmvawa6ya5fx4qyf27a85p34z07z060h352qxgl65fr6d4ugmzm5tzxq',
    components : {
      idType       : 'EXTERNAL',
      version      : 1,
      network      : 'bitcoin',
      genesisBytes : Buffer.from('be0db3aeee89da24d50112af74f40c6a27f84fd3ef1a280647f5448f4daf11b1', 'hex')
    }
  },
  {
    did        : 'did:btcr2:x1qklqmvawa6ya5fx4qyf27a85p34z07z060h352qxgl65fr6d4ugmzjvc6fe',
    components : {
      idType       : 'EXTERNAL',
      version      : 1,
      network      : 'mutinynet',
      genesisBytes : Buffer.from('be0db3aeee89da24d50112af74f40c6a27f84fd3ef1a280647f5448f4daf11b1', 'hex')
    }
  },
  {
    did        : 'did:btcr2:x1q2lqmvawa6ya5fx4qyf27a85p34z07z060h352qxgl65fr6d4ugmzxrg4q8',
    components : {
      idType       : 'EXTERNAL',
      version      : 1,
      network      : 'regtest',
      genesisBytes : Buffer.from('be0db3aeee89da24d50112af74f40c6a27f84fd3ef1a280647f5448f4daf11b1', 'hex')
    }
  },
  {
    did        : 'did:btcr2:x1qxlqmvawa6ya5fx4qyf27a85p34z07z060h352qxgl65fr6d4ugmzpt7a9h',
    components : {
      idType       : 'EXTERNAL',
      version      : 1,
      network      : 'signet',
      genesisBytes : Buffer.from('be0db3aeee89da24d50112af74f40c6a27f84fd3ef1a280647f5448f4daf11b1', 'hex')
    }
  },
  {
    did        : 'did:btcr2:x1qwlqmvawa6ya5fx4qyf27a85p34z07z060h352qxgl65fr6d4ugmzuua2rs',
    components : {
      idType       : 'EXTERNAL',
      version      : 1,
      network      : 'testnet3',
      genesisBytes : Buffer.from('be0db3aeee89da24d50112af74f40c6a27f84fd3ef1a280647f5448f4daf11b1', 'hex')
    }
  },
  {
    did        : 'did:btcr2:x1qjlqmvawa6ya5fx4qyf27a85p34z07z060h352qxgl65fr6d4ugmzgnd92w',
    components : {
      idType       : 'EXTERNAL',
      version      : 1,
      network      : 'testnet4',
      genesisBytes : Buffer.from('be0db3aeee89da24d50112af74f40c6a27f84fd3ef1a280647f5448f4daf11b1', 'hex')
    }
  }
];

describe('Identifier Encode', () => {

  it('should properly encode and match each vector', () => {
    vectors.map(({ did, components }) => {
      expect(Identifier.encode(components)).to.equal(did);
    });
  });
});