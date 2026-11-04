// Minimal ambient types for the Bun test runner, so `tests/**` can be type-checked
// without adding @types/bun (which would need a bun.lock update).
declare module "bun:test" {
    type TestCallback = () => void | Promise<void>;
    export function describe(name: string, fn: TestCallback): void;
    export function test(name: string, fn: TestCallback): void;
    export function it(name: string, fn: TestCallback): void;
    export function beforeEach(fn: TestCallback): void;
    export function afterEach(fn: TestCallback): void;
    export function beforeAll(fn: TestCallback): void;
    export function afterAll(fn: TestCallback): void;
    export const expect: (value: unknown) => any;
    export const mock: any;
}
