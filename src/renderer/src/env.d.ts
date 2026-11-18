/// <reference types="../../preload/api.d.ts" />
import type { DetailedHTMLProps, HTMLAttributes } from 'react'

declare module 'react' {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      /** Extension buttons, provided by electron-chrome-extensions. */
      'browser-action-list': DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
        partition?: string
        tab?: string
        alignment?: string
      }
    }
  }
}
