/// <reference types="vite/client" />

/** build 當下的 git commit（vite.config.ts 的 define），設定頁顯示版本用。 */
declare const __GIT_HASH__: string

/** build 當下 HEAD 指到的 git tag（沒有就是 null），設定頁顯示版本用。 */
declare const __GIT_TAG__: string | null
