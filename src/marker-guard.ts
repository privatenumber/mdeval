import { types } from 'node:util';

const { then } = Promise.prototype;
const noop = () => {};

export const guardMarker = <T>(value: T): T => {
	if (types.isPromise(value)) {
		then.call(value, noop, noop);
	}
	return value;
};
