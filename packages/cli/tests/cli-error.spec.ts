import * as chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { CLIError } from '../src/error.js';

chai.use(chaiAsPromised);
const { expect } = chai;

describe('CLIError', () => {
  it('captures message, type, and data', () => {
    const data = { foo: 'bar' };
    const error = new CLIError('boom', 'CUSTOM', data);

    expect(error).to.be.instanceOf(CLIError);
    expect(error.message).to.equal('boom');
    expect(error.type).to.equal('CUSTOM');
    expect(error.data).to.deep.equal(data);
  });

  it('has name set to CLIError regardless of type', () => {
    const error = new CLIError('msg', 'INVALID_ARGUMENT_ERROR');
    expect(error.name).to.equal('CLIError');
    expect(error.type).to.equal('INVALID_ARGUMENT_ERROR');
  });

  it('defaults type to CLIError when not specified', () => {
    const error = new CLIError('oops');
    expect(error.type).to.equal('CLIError');
    expect(error.name).to.equal('CLIError');
  });
});
