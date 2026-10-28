import { expect } from 'chai';
import { JSONPatch, MethodError, type PatchOperation } from '../src/index.js';

/** Apply a patch that the test writes as plain data. */
function apply(source: unknown, operations: unknown): any {
  return JSONPatch.apply(source as Record<string, unknown>, operations as PatchOperation[]);
}

/** Apply a patch that must fail, and return the error. */
function refusal(source: unknown, operations: unknown): MethodError {
  try {
    apply(source, operations);
  } catch(error) {
    expect(error).to.be.instanceOf(MethodError);
    expect((error as MethodError).type).to.equal('JSON_PATCH_APPLY_ERROR');
    return error as MethodError;
  }
  return expect.fail('the patch applied');
}

describe('JSONPatch', () => {
  it('applies patches without mutating the source', () => {
    const source = { a: 1, nested: { b: 2 } };
    const ops: PatchOperation[] = [
      { op: 'replace', path: '/a', value: 3 },
      { op: 'add', path: '/nested/c', value: 4 }
    ];

    const result = JSONPatch.apply(source, ops);
    expect(result).to.deep.equal({ a: 3, nested: { b: 2, c: 4 } });
    expect(source).to.deep.equal({ a: 1, nested: { b: 2 } }); // unmodified
  });

  it('rejects invalid operations with MethodError', () => {
    const source = { a: 1 };
    const ops = [{ op: 'move', path: '/b' } as any];
    expect(() => JSONPatch.apply(source, ops)).to.throw(MethodError, 'Invalid JSON Patch operations');
  });

  describe('the examples of RFC 6902 Appendix A', () => {
    // A.13 (a duplicate "op" member) is not in the table: JSON.parse keeps the last member,
    // so the duplicate does not reach the patch.
    const applied: Array<[string, unknown, unknown[], unknown]> = [
      ['A.1 adds an object member', { foo: 'bar' }, [{ op: 'add', path: '/baz', value: 'qux' }], { baz: 'qux', foo: 'bar' }],
      ['A.2 adds an array element', { foo: ['bar', 'baz'] }, [{ op: 'add', path: '/foo/1', value: 'qux' }], { foo: ['bar', 'qux', 'baz'] }],
      ['A.3 removes an object member', { baz: 'qux', foo: 'bar' }, [{ op: 'remove', path: '/baz' }], { foo: 'bar' }],
      ['A.4 removes an array element', { foo: ['bar', 'qux', 'baz'] }, [{ op: 'remove', path: '/foo/1' }], { foo: ['bar', 'baz'] }],
      ['A.5 replaces a value', { baz: 'qux', foo: 'bar' }, [{ op: 'replace', path: '/baz', value: 'boo' }], { baz: 'boo', foo: 'bar' }],
      [
        'A.6 moves a value',
        { foo: { bar: 'baz', waldo: 'fred' }, qux: { corge: 'grault' } },
        [{ op: 'move', from: '/foo/waldo', path: '/qux/thud' }],
        { foo: { bar: 'baz' }, qux: { corge: 'grault', thud: 'fred' } }
      ],
      [
        'A.7 moves an array element',
        { foo: ['all', 'grass', 'cows', 'eat'] },
        [{ op: 'move', from: '/foo/1', path: '/foo/3' }],
        { foo: ['all', 'cows', 'eat', 'grass'] }
      ],
      [
        'A.8 passes a test',
        { baz: 'qux', foo: ['a', 2, 'c'] },
        [{ op: 'test', path: '/baz', value: 'qux' }, { op: 'test', path: '/foo/1', value: 2 }],
        { baz: 'qux', foo: ['a', 2, 'c'] }
      ],
      [
        'A.10 adds a nested member object',
        { foo: 'bar' },
        [{ op: 'add', path: '/child', value: { grandchild: {} } }],
        { foo: 'bar', child: { grandchild: {} } }
      ],
      [
        'A.11 ignores an unrecognized member',
        { foo: 'bar' },
        [{ op: 'add', path: '/baz', value: 'qux', xyz: 123 }],
        { foo: 'bar', baz: 'qux' }
      ],
      ['A.14 decodes ~01 to ~1', { '/': 9, '~1': 10 }, [{ op: 'test', path: '/~01', value: 10 }], { '/': 9, '~1': 10 }],
      ['A.16 adds an array value', { foo: ['bar'] }, [{ op: 'add', path: '/foo/-', value: ['abc', 'def'] }], { foo: ['bar', ['abc', 'def']] }],
    ];
    for (const [name, source, operations, expected] of applied) {
      it(name, () => {
        expect(apply(source, operations)).to.deep.equal(expected);
      });
    }

    const refused: Array<[string, unknown, unknown[], RegExp]> = [
      ['A.9 fails a test', { baz: 'qux' }, [{ op: 'test', path: '/baz', value: 'bar' }], /Test operation failed/],
      ['A.12 fails an add to a target that does not exist', { foo: 'bar' }, [{ op: 'add', path: '/baz/bat', value: 'qux' }], /parent of "\/baz\/bat" does not exist/],
      ['A.15 fails a test of a number against a string', { '/': 9, '~1': 10 }, [{ op: 'test', path: '/~01', value: '10' }], /Test operation failed/],
    ];
    for (const [name, source, operations, message] of refused) {
      it(name, () => {
        expect(refusal(source, operations).message).to.match(message);
      });
    }
  });

  describe('the examples of RFC 6901 section 5', () => {
    const document = {
      'foo'  : ['bar', 'baz'],
      ''     : 0,
      'a/b'  : 1,
      'c%d'  : 2,
      'e^f'  : 3,
      'g|h'  : 4,
      'i\\j' : 5,
      'k"l'  : 6,
      ' '    : 7,
      'm~n'  : 8,
    };
    const pointers: Array<[string, unknown]> = [
      ['', document], ['/foo', ['bar', 'baz']], ['/foo/0', 'bar'], ['/', 0], ['/a~1b', 1], ['/c%d', 2],
      ['/e^f', 3], ['/g|h', 4], ['/i\\j', 5], ['/k"l', 6], ['/ ', 7], ['/m~0n', 8],
    ];
    for (const [pointer, value] of pointers) {
      it(`"${pointer}" names the value ${JSON.stringify(value).slice(0, 20)}`, () => {
        expect(apply(document, [{ op: 'test', path: pointer, value }])).to.deep.equal(document);
      });
    }
  });

  describe('JSON Pointer syntax (RFC 6901 section 3)', () => {
    const source = () => ({ a: 1, x: 2 });
    const refused: Array<[string, unknown, RegExp]> = [
      ['a path with the escape ~2', { op: 'add', path: '/x~2y', value: 1 }, /Operation.path is not a JSON Pointer \(RFC 6901 section 3\): \/x~2y/],
      ['a path that ends in ~', { op: 'add', path: '/x~', value: 1 }, /Operation.path is not a JSON Pointer .*: \/x~$/],
      ['a path with no leading /', { op: 'add', path: 'a', value: 1 }, /Operation.path is not a JSON Pointer .*: a$/],
      ['a copy from with no leading /', { op: 'copy', from: 'a', path: '/c' }, /Operation.from is not a JSON Pointer .*: a$/],
      ['a move from with no leading /', { op: 'move', from: 'a', path: '/c' }, /Operation.from is not a JSON Pointer .*: a$/],
      ['a move from with the escape ~2', { op: 'move', from: '/x~2', path: '/c' }, /Operation.from is not a JSON Pointer .*: \/x~2$/],
    ];
    for (const [name, operation, message] of refused) {
      it(`refuses ${name} before the first operation runs`, () => {
        const error = refusal(source(), [{ op: 'add', path: '/first', value: 0 }, operation]);
        expect(error.message).to.match(/^Invalid JSON Patch operations: /);
        expect(error.message).to.match(message);
        expect(error.data?.index).to.equal(1);
      });
    }

    it('decodes ~1 to / and ~0 to ~, in this order', () => {
      expect(apply({}, [
        { op: 'add', path: '/a~1b', value: 1 },
        { op: 'add', path: '/m~0n', value: 2 },
        { op: 'add', path: '/~01', value: 3 },
        { op: 'add', path: '/', value: 4 },
      ])).to.deep.equal({ 'a/b': 1, 'm~n': 2, '~1': 3, '': 4 });
    });
  });

  describe('array tokens (RFC 6901 section 4)', () => {
    const source = () => ({ arr: ['a', 'b', 'c'], o: { x: 1 } });
    const notIndex = ['01', '00', '', '-1', '1.0', '+1', ' 1', '1e0', '0x1'];
    for (const token of notIndex) {
      it(`refuses an add at the array token "${token}"`, () => {
        expect(refusal(source(), [{ op: 'add', path: `/arr/${token}`, value: 'Z' }]).message)
          .to.include(`"${token}" is not an array index (RFC 6901 section 4)`);
      });
    }

    for (const token of ['4294967296', '4294967297', '2147483648', '99999999999999999999']) {
      it(`refuses an add at the index ${token}, past the end`, () => {
        expect(refusal(source(), [{ op: 'add', path: `/arr/${token}`, value: 'Z' }]).message)
          .to.match(/is greater than the number of elements \(3\) \(RFC 6902 section 4.1\)/);
      });
    }

    for (const path of ['/arr/01', '/arr/00', '/arr/', '/arr/4294967296', '/arr/3', '/arr/-']) {
      it(`refuses a test at ${path}`, () => {
        expect(refusal(source(), [{ op: 'test', path, value: 'a' }]).message).to.include(`path "${path}" does not exist`);
      });
    }

    it('refuses a remove, a replace, and a copy from at the token -', () => {
      expect(refusal(source(), [{ op: 'remove', path: '/arr/-' }]).message).to.include('path "/arr/-" does not exist');
      expect(refusal(source(), [{ op: 'replace', path: '/arr/-', value: 1 }]).message).to.include('path "/arr/-" does not exist');
      expect(refusal(source(), [{ op: 'copy', from: '/arr/-', path: '/c' }]).message).to.include('from "/arr/-" does not exist');
    });

    it('adds at an index of 0 to the number of elements, and appends at -', () => {
      expect(apply(source(), [{ op: 'add', path: '/arr/0', value: 'Z' }]).arr).to.deep.equal(['Z', 'a', 'b', 'c']);
      expect(apply(source(), [{ op: 'add', path: '/arr/3', value: 'Z' }]).arr).to.deep.equal(['a', 'b', 'c', 'Z']);
      expect(apply(source(), [{ op: 'add', path: '/arr/-', value: 'Z' }]).arr).to.deep.equal(['a', 'b', 'c', 'Z']);
    });

    it('reads 01 and - as member names in an object', () => {
      expect(apply(source(), [
        { op: 'add', path: '/o/01', value: 1 },
        { op: 'add', path: '/o/-', value: 2 },
      ]).o).to.deep.equal({ 'x': 1, '01': 1, '-': 2 });
    });
  });

  describe('own members only (RFC 6901 section 4)', () => {
    const inherited = ['toString', 'valueOf', 'hasOwnProperty', 'isPrototypeOf', 'constructor', '__proto__'];
    const source = () => ({ o: { x: 1 }, sink: {} });
    for (const name of inherited) {
      it(`refuses a remove, a replace, a test, a copy, and a move of the inherited member ${name}`, () => {
        const path = `/o/${name}`;
        expect(refusal(source(), [{ op: 'remove', path }]).message).to.include(`path "${path}" does not exist`);
        expect(refusal(source(), [{ op: 'replace', path, value: 1 }]).message).to.include(`path "${path}" does not exist`);
        expect(refusal(source(), [{ op: 'test', path, value: null }]).message).to.include(`path "${path}" does not exist`);
        expect(refusal(source(), [{ op: 'copy', from: path, path: '/c' }]).message).to.include(`from "${path}" does not exist`);
        expect(refusal(source(), [{ op: 'move', from: path, path: '/c' }]).message).to.include(`from "${path}" does not exist`);
        expect(refusal(source(), [{ op: 'remove', path: `/${name}` }]).message).to.include('does not exist');
      });
    }

    it('refuses the length of an array or a string', () => {
      expect(refusal({ arr: [1], s: 'ab' }, [{ op: 'test', path: '/arr/length', value: 1 }]).message).to.include('does not exist');
      expect(refusal({ arr: [1], s: 'ab' }, [{ op: 'test', path: '/s/length', value: 2 }]).message).to.include('does not exist');
      expect(refusal({ arr: [1], s: 'ab' }, [{ op: 'test', path: '/s/0', value: 'a' }]).message).to.include('does not exist');
    });

    const exploits: Array<{ name: string; op: unknown; owner: any; prop: string }> = [
      { name: 'Object.keys via /constructor/keys', op: { op: 'replace', path: '/constructor/keys', value: null }, owner: Object, prop: 'keys' },
      { name: 'Object.assign via /constructor/assign', op: { op: 'add', path: '/constructor/assign', value: null }, owner: Object, prop: 'assign' },
      { name: 'Array.of via /arr/constructor/of', op: { op: 'replace', path: '/arr/constructor/of', value: null }, owner: Array, prop: 'of' },
      { name: 'Object.freeze via a move from', op: { op: 'move', from: '/constructor/freeze', path: '/sink/moved' }, owner: Object, prop: 'freeze' },
      { name: 'Object.entries via a copy from', op: { op: 'copy', from: '/constructor/entries', path: '/sink/copied' }, owner: Object, prop: 'entries' },
    ];
    for (const { name, op, owner, prop } of exploits) {
      it(`refuses ${name} and leaves the global intact`, () => {
        const original = owner[prop];
        try {
          expect(refusal({ id: 'did:btcr2:x', arr: [1, 2], sink: {} }, [op]).message).to.include('does not exist');
          expect(owner[prop]).to.equal(original);
          expect(typeof owner[prop]).to.equal('function');
        } finally {
          // Repair the global if the engine ever writes it, so one failure cannot cascade.
          owner[prop] = original;
        }
      });
    }

    it('refuses an add under an inherited __proto__ or constructor, with no prototype change', () => {
      for (const path of ['/__proto__/polluted', '/constructor/prototype/polluted', '/o/__proto__/polluted']) {
        expect(refusal({ o: {} }, [{ op: 'add', path, value: 'x' }]).message).to.include('does not exist');
      }
      expect(({} as Record<string, unknown>).polluted).to.equal(undefined);
    });
  });

  describe('each member name is data', () => {
    const names = ['constructor', 'prototype', '__proto__', 'hasOwnProperty', 'toString'];
    for (const name of names) {
      it(`applies add, replace, test, copy, move, and remove on an own member ${name}`, () => {
        const path = `/o/${name}`;
        const result = apply({ o: {} }, [
          { op: 'add', path, value: { polluted: true } },
          { op: 'test', path, value: { polluted: true } },
          { op: 'replace', path, value: { polluted: 1 } },
          { op: 'copy', from: path, path: '/copy' },
          { op: 'move', from: path, path: '/m' },
          { op: 'add', path, value: 'again' },
        ]);
        expect(Object.keys(result.o)).to.deep.equal([name]);
        expect(Object.getOwnPropertyDescriptor(result.o, name)?.value).to.equal('again');
        expect(Object.getPrototypeOf(result.o)).to.equal(Object.prototype);
        expect(result.copy).to.deep.equal({ polluted: 1 });
        expect(result.m).to.deep.equal({ polluted: 1 });
        const removed = apply(result, [{ op: 'remove', path }]);
        expect(Object.keys(removed.o)).to.deep.equal([]);
        expect(({} as Record<string, unknown>).polluted).to.equal(undefined);
      });
    }

    it('keeps a __proto__ member of the source document as data', () => {
      const source = JSON.parse('{"o":{"__proto__":{"polluted":true}}}');
      const result = apply(source, [{ op: 'add', path: '/o/__proto__/x', value: 1 }]);
      expect(Object.getPrototypeOf(result.o)).to.equal(Object.prototype);
      expect(Object.getOwnPropertyDescriptor(result.o, '__proto__')?.value).to.deep.equal({ polluted: true, x: 1 });
      expect(result.o.polluted).to.equal(undefined);
    });

    it('adds a __proto__ member at the root as data', () => {
      const result = apply({ a: 1 }, [{ op: 'add', path: '/__proto__', value: { polluted: true } }]);
      expect(Object.getPrototypeOf(result)).to.equal(Object.prototype);
      expect(result.polluted).to.equal(undefined);
      expect(JSON.stringify(result)).to.equal('{"a":1,"__proto__":{"polluted":true}}');
    });

    it('keeps the position of a member on a replace and on an add of a member that exists', () => {
      const result = apply({ a: 1, b: 2, c: 3 }, [
        { op: 'replace', path: '/a', value: 9 },
        { op: 'add', path: '/b', value: 8 },
      ]);
      expect(Object.keys(result)).to.deep.equal(['a', 'b', 'c']);
    });
  });

  describe('test equality (RFC 6902 section 4.6)', () => {
    const equal: Array<[string, unknown, unknown]> = [
      ['a value with a hasOwnProperty member', { hasOwnProperty: 'x' }, { hasOwnProperty: 'x' }],
      ['a nested hasOwnProperty member', { p: { hasOwnProperty: 'x', q: [1] } }, { p: { q: [1], hasOwnProperty: 'x' } }],
      ['objects with another member order', { a: 1, b: { c: 2, d: 3 } }, { b: { d: 3, c: 2 }, a: 1 }],
      ['1 and 1.0', 1, 1.0],
      ['0 and -0', 0, -0],
      ['the same strings', 'abc', 'abc'],
      ['null and null', null, null],
      ['empty objects', {}, {}],
      ['empty arrays', [], []],
    ];
    for (const [name, documentValue, value] of equal) {
      it(`passes for ${name}`, () => {
        expect(() => apply({ v: documentValue }, [{ op: 'test', path: '/v', value }])).to.not.throw();
      });
    }

    const notEqual: Array<[string, unknown, unknown]> = [
      ['arrays in another order', [1, 2], [2, 1]],
      ['arrays of another length', [1, 2], [1, 2, 3]],
      ['objects with another member count', { a: 1 }, { a: 1, b: 2 }],
      ['objects with another member name', { a: 1 }, { b: 1 }],
      ['a number and a string', 10, '10'],
      ['an array and an object', [], {}],
      ['an object and an array', {}, []],
      ['null and an object', null, {}],
      ['an object and null', {}, null],
      ['false and null', false, null],
      ['0 and false', 0, false],
      ['NFC and NFD forms of a string', '\u00e9', 'e\u0301'],
    ];
    for (const [name, documentValue, value] of notEqual) {
      it(`fails for ${name}`, () => {
        expect(refusal({ v: documentValue }, [{ op: 'test', path: '/v', value }]).message)
          .to.equal('JSON Patch application failed at operation 0 (test /v): Test operation failed');
      });
    }

    it('compares the whole document at the path ""', () => {
      expect(() => apply({ a: [1] }, [{ op: 'test', path: '', value: { a: [1] } }])).to.not.throw();
      expect(refusal({ a: [1] }, [{ op: 'test', path: '', value: { a: [2] } }]).message).to.include('Test operation failed');
    });
  });

  describe('move (RFC 6902 section 4.4)', () => {
    const source = () => ({ s: [{ x: 1 }, { y: 2 }], o: { x: 1 }, 'a/b': { c: 1 }, a: 1 });
    const intoChild: Array<[string, string]> = [['/s/0', '/s/0/z'], ['/o', '/o/c'], ['', '/c'], ['/a~1b', '/a~1b/c'], ['/o', '/o/c/d']];
    for (const [from, path] of intoChild) {
      it(`refuses a move from "${from}" into its child ${path}`, () => {
        expect(refusal(source(), [{ op: 'move', from, path }]).message).to.equal(
          'Invalid JSON Patch operations: Operation.from is a proper prefix of Operation.path: a location cannot move into one of its children (RFC 6902 section 4.4)'
        );
      });
    }

    it('moves a location to a sibling with the same prefix text', () => {
      expect(apply(source(), [{ op: 'move', from: '/o', path: '/ox' }])).to.have.property('ox').that.deep.equals({ x: 1 });
      expect(apply(source(), [{ op: 'move', from: '/a', path: '/a~1b/a' }])['a/b']).to.deep.equal({ c: 1, a: 1 });
    });

    it('accepts a move to the same location, if the location exists', () => {
      expect(apply(source(), [{ op: 'move', from: '/o', path: '/o' }])).to.deep.equal(source());
      expect(apply(source(), [{ op: 'move', from: '', path: '' }])).to.deep.equal(source());
      expect(refusal(source(), [{ op: 'move', from: '/z', path: '/z' }]).message).to.include('from "/z" does not exist');
    });

    it('moves a value to the whole document', () => {
      expect(apply(source(), [{ op: 'move', from: '/o', path: '' }])).to.deep.equal({ x: 1 });
    });
  });

  describe('the index of an add, a copy, and a move (RFC 6902 sections 4.1, 4.4, 4.5)', () => {
    const source = () => ({ arr: ['a', 'b', 'c'], a: 'A' });

    it('refuses a copy and a move to an index past the end', () => {
      expect(refusal(source(), [{ op: 'copy', from: '/a', path: '/arr/9' }]).message)
        .to.equal('JSON Patch application failed at operation 0 (copy /arr/9): index 9 is greater than the number of elements (3) (RFC 6902 section 4.1)');
      expect(refusal(source(), [{ op: 'move', from: '/a', path: '/arr/9' }]).message).to.include('index 9 is greater');
    });

    it('checks the index of a move on the array after the remove', () => {
      expect(refusal(source(), [{ op: 'move', from: '/arr/0', path: '/arr/3' }]).message)
        .to.include('index 3 is greater than the number of elements (2)');
      expect(apply(source(), [{ op: 'move', from: '/arr/0', path: '/arr/2' }]).arr).to.deep.equal(['b', 'c', 'a']);
    });

    it('accepts a copy to the index of the number of elements', () => {
      expect(apply(source(), [{ op: 'copy', from: '/a', path: '/arr/3' }]).arr).to.deep.equal(['a', 'b', 'c', 'A']);
    });

    it('copies a deep value, so a later operation changes one location only', () => {
      const result = apply({ a: { b: [1] } }, [
        { op: 'copy', from: '/a', path: '/c' },
        { op: 'add', path: '/c/b/-', value: 2 },
      ]);
      expect(result).to.deep.equal({ a: { b: [1] }, c: { b: [1, 2] } });
    });
  });

  describe('members that the operation does not define (RFC 6902 section 4)', () => {
    it('ignores them', () => {
      expect(apply({ a: 1 }, [
        { op: 'add', path: '/b', value: 2, from: '/constructor' },
        { op: 'remove', path: '/a', value: 'ignored', from: 7 },
        { op: 'test', path: '/b', value: 2, from: 'not a pointer' },
        { op: 'replace', path: '/b', value: 3, extra: { nested: true } },
      ])).to.deep.equal({ b: 3 });
    });
  });

  describe('the whole document (the path "")', () => {
    it('gives the value of an add or a replace', () => {
      expect(apply({ a: 1 }, [{ op: 'add', path: '', value: { b: 2 } }])).to.deep.equal({ b: 2 });
      expect(apply({ a: 1 }, [{ op: 'replace', path: '', value: [1] }])).to.deep.equal([1]);
      expect(apply({ a: 1 }, [{ op: 'replace', path: '', value: null }])).to.equal(null);
      expect(apply({ a: 1 }, [{ op: 'copy', from: '/a', path: '' }])).to.equal(1);
    });

    it('refuses a remove of the whole document', () => {
      const error = refusal({ a: 1 }, [{ op: 'remove', path: '' }]);
      expect(error.message).to.equal(
        'JSON Patch application failed at operation 0 (remove ): a remove of the whole document gives no document (RFC 6902 section 4.2)'
      );
      expect(error.data).to.deep.equal({ index: 0, op: 'remove', path: '' });
    });

    it('refuses an add under a value that is not an object or an array', () => {
      expect(refusal({ a: 1 }, [{ op: 'replace', path: '', value: 5 }, { op: 'add', path: '/x', value: 1 }]).message)
        .to.include('(add /x): the parent of "/x" is not an object or an array');
      expect(refusal({ a: 'A' }, [{ op: 'add', path: '/a/x', value: 1 }]).message)
        .to.include('the parent of "/a/x" is not an object or an array');
    });
  });

  describe('atomic apply', () => {
    it('leaves the source and the operations unchanged if a later operation fails', () => {
      const source = { a: 1, list: [1, 2] };
      const ops: PatchOperation[] = [
        { op: 'replace', path: '/a', value: 2 },
        { op: 'remove', path: '/list/0' },
        { op: 'remove', path: '/missing' },
      ];
      const given = JSON.parse(JSON.stringify(ops));
      const error = refusal(source, ops);
      expect(error.message).to.equal('JSON Patch application failed at operation 2 (remove /missing): path "/missing" does not exist');
      expect(error.data).to.deep.equal({ index: 2, op: 'remove', path: '/missing' });
      expect(source).to.deep.equal({ a: 1, list: [1, 2] });
      expect(ops).to.deep.equal(given);
    });

    it('names the from of a failed move or copy in the error data', () => {
      expect(refusal({ a: 1 }, [{ op: 'copy', from: '/b', path: '/c' }]).data)
        .to.deep.equal({ index: 0, op: 'copy', path: '/c', from: '/b' });
      expect(refusal({ a: 1 }, [{ op: 'move', from: '/b', path: '/c' }]).message)
        .to.equal('JSON Patch application failed at operation 0 (move /c): from "/b" does not exist');
    });

    it('fails a remove and a replace of a path that does not exist', () => {
      expect(refusal({ a: 1 }, [{ op: 'remove', path: '/missing' }]).message).to.include('path "/missing" does not exist');
      expect(refusal({ a: 1 }, [{ op: 'replace', path: '/missing', value: 1 }]).message).to.include('path "/missing" does not exist');
      expect(refusal({ a: 1 }, [{ op: 'remove', path: '/a/b' }]).message).to.include('path "/a/b" does not exist');
    });
  });

  describe('input with no JSON form', () => {
    it('refuses operations that are not an array with the text of the check', () => {
      for (const operations of [undefined, null, {}, 'add', 1]) {
        const error = refusal({ a: 1 }, operations);
        expect(error.message).to.equal('Invalid JSON Patch operations: Operations must be an array');
        expect(error.data?.error).to.be.instanceOf(MethodError);
      }
    });

    it('refuses operations with a cycle or a BigInt with a MethodError', () => {
      const cyclic: Record<string, unknown> = { op: 'add', path: '/a' };
      cyclic.value = cyclic;
      expect(refusal({}, [cyclic]).message).to.match(/^Invalid JSON Patch operations: the operations have no JSON form: /);
      expect(refusal({}, [{ op: 'add', path: '/a', value: 1n }]).message).to.match(/the operations have no JSON form: .*BigInt/);
    });

    it('refuses operations whose toJSON throws a value that is not an Error', () => {
      const value = { toJSON: (): never => { throw { toString: 'not a function' }; } };
      expect(refusal({}, [{ op: 'add', path: '/a', value }]).message)
        .to.equal('Invalid JSON Patch operations: the operations have no JSON form: a value that is not an Error was thrown');
    });

    it('refuses a value too deep for JSON.stringify with a MethodError', () => {
      let value: unknown[] = [];
      for (let depth = 0; depth < 100000; depth++) value = [value];
      expect(refusal({}, [{ op: 'test', path: '', value }]).message).to.match(/the operations have no JSON form: /);
    });

    it('refuses a source document with no JSON form', () => {
      const cyclic: Record<string, unknown> = {};
      cyclic.self = cyclic;
      expect(refusal(cyclic, [{ op: 'add', path: '/a', value: 1 }]).message)
        .to.match(/^JSON Patch application failed: the source document has no JSON form: /);
      expect(refusal(undefined, [{ op: 'add', path: '/a', value: 1 }]).message)
        .to.equal('JSON Patch application failed: the source document has no JSON form: the value has no JSON text');
    });
  });

  describe('a JSON copy of the operations (ADR 139)', () => {
    it('leaves the operations unchanged if a later operation writes inside an added value', () => {
      const ops: PatchOperation[] = [
        { op: 'add', path: '/service/-', value: { id: '#s2', note: 'x' } },
        { op: 'remove', path: '/service/1/note' },
      ];
      const given = JSON.parse(JSON.stringify(ops));
      const result = JSONPatch.apply({ service: [{ id: '#s1' }] }, ops);
      expect(result).to.deep.equal({ service: [{ id: '#s1' }, { id: '#s2' }] });
      expect(ops).to.deep.equal(given);
      // The operations as given apply again with the same result.
      expect(JSONPatch.apply({ service: [{ id: '#s1' }] }, ops)).to.deep.equal(result);
    });

    it('leaves the operations unchanged if a later operation appends to an added array', () => {
      const ops: PatchOperation[] = [
        { op: 'add', path: '/list', value: ['a'] },
        { op: 'add', path: '/list/-', value: 'b' },
      ];
      const given = JSON.parse(JSON.stringify(ops));
      expect(JSONPatch.apply({}, ops)).to.deep.equal({ list: ['a', 'b'] });
      expect(ops).to.deep.equal(given);
    });

    it('returns a document that shares no object with the operations', () => {
      const ops: PatchOperation[] = [{ op: 'add', path: '/a', value: { b: 1 } }];
      const result = JSONPatch.apply({}, ops);
      result.a.b = 2;
      expect(ops[0]!.value).to.deep.equal({ b: 1 });
    });

    it('applies the JSON form of each value', () => {
      const ops: PatchOperation[] = [{ op: 'add', path: '/a', value: { at: new Date(0), skip: undefined, n: NaN } }];
      expect(JSONPatch.apply({}, ops)).to.deep.equal({ a: { at: '1970-01-01T00:00:00.000Z', n: null } });
    });

    it('checks the JSON copy: the JSON form of an operation must be valid', () => {
      const disguised = {
        op     : 'replace',
        path   : '/a',
        value  : 1,
        toJSON : () => ({ op: 'frobnicate', path: '/a' }),
      };
      expect(refusal({ a: 1 }, [disguised]).message).to.equal('Invalid JSON Patch operations: Operation.op is not an RFC 6902 operation: frobnicate');
    });

    it('names the index of the failing operation in the error message', () => {
      const ops: PatchOperation[] = [
        { op: 'replace', path: '/a', value: 2 },
        { op: 'remove', path: '/missing' },
      ];
      expect(() => JSONPatch.apply({ a: 1 }, ops)).to.throw(MethodError, /at operation 1 \(remove \/missing\).*does not exist/);
    });
  });

  describe('validateOperations', () => {
    it('returns null for a valid patch, with no document', () => {
      expect(JSONPatch.validateOperations([
        { op: 'add', path: '/a/-', value: null },
        { op: 'remove', path: '/x/0' },
        { op: 'replace', path: '', value: {} },
        { op: 'move', from: '/a', path: '/b' },
        { op: 'copy', from: '/a', path: '/a/b' },
        { op: 'test', path: '/~0~1', value: false },
      ])).to.equal(null);
      expect(JSONPatch.validateOperations([])).to.equal(null);
    });

    const invalid: Array<[unknown, string]> = [
      ['not an array', 'Operations must be an array'],
      [[null], 'Operation must be an object'],
      [[['add', '/a']], 'Operation must be an object'],
      [[{ path: '/a' }], 'Operation.op must be a string'],
      [[{ op: 'frobnicate', path: '/a' }], 'Operation.op is not an RFC 6902 operation: frobnicate'],
      [[{ op: 'add', value: 1 }], 'Operation.path must be a string'],
      [[{ op: 'add', path: 'a', value: 1 }], 'Operation.path is not a JSON Pointer (RFC 6901 section 3): a'],
      [[{ op: 'add', path: '/a' }], 'Operation.value is required for op=add'],
      [[{ op: 'replace', path: '/a', value: undefined }], 'Operation.value is required for op=replace'],
      [[{ op: 'test', path: '/a' }], 'Operation.value is required for op=test'],
      [[{ op: 'copy', path: '/a' }], 'Operation.from must be a string for op=copy'],
      [[{ op: 'move', path: '/a', from: 1 }], 'Operation.from must be a string for op=move'],
      [[{ op: 'move', path: '/a', from: '/a~' }], 'Operation.from is not a JSON Pointer (RFC 6901 section 3): /a~'],
    ];
    for (const [operations, message] of invalid) {
      it(`returns "${message}" for ${JSON.stringify(operations)}`, () => {
        const error = JSONPatch.validateOperations(operations);
        expect(error).to.be.instanceOf(MethodError);
        expect(error?.type).to.equal('JSON_PATCH_VALIDATION_ERROR');
        expect(error?.message).to.equal(message);
        expect(error?.data?.index).to.equal(Array.isArray(operations) ? 0 : undefined);
      });
    }

    it('names the index of the first operation that fails a check', () => {
      expect(JSONPatch.validateOperations([
        { op: 'add', path: '/a', value: 1 },
        { op: 'remove', path: '/b' },
        { op: 'add', path: '/c' },
        { op: 'add', path: 'd' },
      ])?.data).to.deep.equal({ index: 2 });
    });

    it('accepts a value of null, false, 0, and the empty string', () => {
      for (const value of [null, false, 0, '']) {
        expect(JSONPatch.validateOperations([{ op: 'add', path: '/a', value }])).to.equal(null);
      }
    });
  });
});
