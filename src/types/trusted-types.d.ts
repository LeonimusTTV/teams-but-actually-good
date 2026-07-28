/**
 * Minimal ambient declarations for the Trusted Types browser API.
 * Spec: https://w3c.github.io/trusted-types/dist/spec/
 *
 * This file is intentionally import-free so TypeScript treats it as ambient
 * and auto-includes it for the whole compilation (no reference directive needed).
 */

interface TrustedHTML {
  toString(): string;
}

interface TrustedScript {
  toString(): string;
}

interface TrustedScriptURL {
  toString(): string;
}

interface TrustedTypePolicyOptions {
  createHTML?: (input: string, ...args: unknown[]) => string | null;
  createScript?: (input: string, ...args: unknown[]) => string | null;
  createScriptURL?: (input: string, ...args: unknown[]) => string | null;
}

interface TrustedTypePolicy {
  readonly name: string;
  createHTML(input: string, ...args: unknown[]): TrustedHTML;
  createScript(input: string, ...args: unknown[]): TrustedScript;
  createScriptURL(input: string, ...args: unknown[]): TrustedScriptURL;
}

interface TrustedTypePolicyFactory {
  createPolicy(
    name: string,
    policyOptions?: TrustedTypePolicyOptions,
  ): TrustedTypePolicy;
  isHTML(value: unknown): value is TrustedHTML;
  isScript(value: unknown): value is TrustedScript;
  isScriptURL(value: unknown): value is TrustedScriptURL;
  readonly defaultPolicy: TrustedTypePolicy | null;
  readonly emptyHTML: TrustedHTML;
  readonly emptyScript: TrustedScript;
}

interface Window {
  trustedTypes?: TrustedTypePolicyFactory;
  __TAURI__?: {
    core: {
      invoke<T = unknown>(
        command: string,
        args?: Record<string, unknown>,
      ): Promise<T>;
    };
  };
}
