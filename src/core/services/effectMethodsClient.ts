import { Effect, unsafeCoerce } from 'effect';

type ClientMethod = (...methodArguments: never[]) => unknown;

/** Convert each callable transport member to the equivalent Effect-returning method. */
export type EffectMethods<Client extends object, Failure> = {
  [Method in keyof Client]: Client[Method] extends ClientMethod
    ? (
        ...methodArguments: Parameters<Client[Method]>
      ) => Effect.Effect<Awaited<ReturnType<Client[Method]>>, Failure>
    : Client[Method];
};

/** Wrap one Promise client so every transport method returns an Effect. */
export const effectMethodsProxy = <Client extends object, Failure>(
  promiseClient: Client,
  mapFailure: (cause: unknown) => Failure,
): EffectMethods<Client, Failure> =>
  unsafeCoerce(
    new Proxy(promiseClient, {
      get(transportClient, methodName, receiver) {
        const transportMember = Reflect.get(transportClient, methodName, receiver);
        if (typeof transportMember !== 'function') return transportMember;
        return (...methodArguments: readonly unknown[]) =>
          Effect.tryPromise({
            try: () => transportMember.apply(transportClient, methodArguments),
            catch: mapFailure,
          });
      },
    }),
  );
