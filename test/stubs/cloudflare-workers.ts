/** Minimal stand-ins for the runtime base classes, enough to instantiate our classes in tests. */
export class WorkflowEntrypoint<E = unknown, P = unknown> {
  constructor(public ctx: unknown, public env: E) {}
  // Keeps the generic parameter "used" for TypeScript.
  protected _p?: P;
}
export class DurableObject<E = unknown> {
  constructor(public ctx: unknown, public env: E) {}
}
export type WorkflowEvent<P> = { payload: P; timestamp: Date; instanceId: string };
export type WorkflowStep = {
  do<T>(name: string, configOrFn: unknown, fn?: () => Promise<T>): Promise<T>;
};
