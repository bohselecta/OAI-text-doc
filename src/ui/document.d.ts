export type DocumentRole = 'viewer' | 'editor' | 'publisher' | 'admin';
export interface DocumentOptions {
  /** Same-origin API route. Identity/workspace changes should remount the element. */
  apiBase?: string;
  documentId?: string;
  /** Short-lived host identity, never a model-provider key. Not persisted. */
  getAccessToken?: () => string | Promise<string>;
}
export declare class DocumentModule extends HTMLElement {
  configure(options: DocumentOptions): this;
}
export declare const DOCUMENT_MANIFEST: Readonly<{
  id: 'language-canvas.document'; label: 'Document'; kind: 'document';
  version: '1.0.0'; customElement: 'language-document';
  acceptedImports: string[]; exports: string[]; nativeSpacesIntegration: false;
}>;
declare global {
  interface HTMLElementTagNameMap { 'language-document': DocumentModule; }
  interface HTMLElementEventMap {
    'document-changed': CustomEvent<{ documentId: string; revision: number }>;
    'document-published': CustomEvent<{ documentId: string; releaseId: string; revision: number }>;
  }
}
