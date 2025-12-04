// Type augmentations for oidc-provider
import { AdapterPayload } from 'oidc-provider';

declare module 'oidc-provider' {
  // Extend AdapterPayload to be compatible with our implementation
  interface AdapterPayload {
    [key: string]: unknown;
  }
}
