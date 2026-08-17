// The slice of Node's test runner and assertion library this project uses.
//
// Written by hand rather than pulled from @types/node because the dependency
// count in README.md is a claim a stranger should be able to check in thirty
// seconds, and @types/node is several megabytes of declarations to hold one
// project to a promise about two imports. Twenty lines a reviewer can read
// beats a package they will not.

declare module 'node:test' {
  export default function test(name: string, fn: () => void | Promise<void>): void;
}

declare module 'node:assert/strict' {
  interface Assert {
    ok(value: unknown, message?: string): asserts value;
    equal(actual: unknown, expected: unknown, message?: string): void;
    notEqual(actual: unknown, expected: unknown, message?: string): void;
    deepEqual(actual: unknown, expected: unknown, message?: string): void;
    match(value: string, pattern: RegExp, message?: string): void;
    throws(fn: () => unknown, message?: string): void;
  }
  const assert: Assert;
  export default assert;
}
