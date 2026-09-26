import type { Metadata } from 'next';

export const noindexRobots: Metadata['robots'] = {
  index: false,
  follow: false,
  googleBot: {
    index: false,
    follow: false,
    noimageindex: true,
  },
};

export const noindexFollowRobots: Metadata['robots'] = {
  index: false,
  follow: true,
  googleBot: {
    index: false,
    follow: true,
  },
};

export const privatePageMetadata: Metadata = {
  robots: noindexRobots,
};
