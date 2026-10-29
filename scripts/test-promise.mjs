// @ts-check
/** Preserve synchronous fixture execution and asynchronous rejection without unnecessary async.
 * @template T
 * @param {()=>T} work
 * @returns {Promise<Awaited<T>>}
 */
export function fixturePromise(work){try{return Promise.resolve(work());}catch(error){return Promise.reject(error instanceof Error?error:Object.assign(new Error('Fixture rejected a non-Error value'),{cause:error}));}}
