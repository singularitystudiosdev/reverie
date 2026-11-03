/* cn(): the shadcn class-merging convention this skill's templates share.
   Source: source-github.md §2 (shadcn-ui/ui, MIT, 122,966 stars,
   https://github.com/shadcn-ui/ui): "cn() with clsx + tailwind-merge, data-slot
   attributes" is the convention taken from that repo, not the package.
   Dependencies are pinned in the repo stack: clsx + tailwind-merge, nothing else. */

import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/* The custom font-size scale from tokens.css (--text-<name>). Without it,
   tailwind-merge reads `text-caption` as a text COLOR and lets it clobber (or
   be clobbered by) `text-muted`, `text-ink`, `text-on-accent`. Declared as
   members of tailwind-merge's `text` theme scale, so they form one font-size
   group: `text-body text-caption` keeps the last, `text-caption text-muted`
   keeps both. Keep in step with the --text-* tokens in tokens.css. */
const FONT_SIZES = [
  'name',
  'title',
  'heading',
  'body',
  'label',
  'caption',
  'display-large',
  'headline-medium',
  'title-medium',
  'body-medium',
  'label-large',
]

/* The radius scale from tokens.css (--radius-<n>, project values 12/20/28/48 and
   the rest of the ladder). tailwind-merge only knows rounded-sm/md/lg/..., so
   `rounded-20 rounded-full` would keep both. Declared as members of its
   `radius` theme scale, so every rounded-<n> (and the side/corner variants)
   conflicts with every other. Keep in step with the --radius-* tokens. */
const RADII = ['0', '2', '4', '6', '8', '12', '16', '20', '24', '28', '32', '48']

const twMerge = extendTailwindMerge({
  extend: { theme: { text: FONT_SIZES, radius: RADII } },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
