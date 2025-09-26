import { defineConfig } from 'vitepress';
import typedocSidebar from '../packages/typedoc-sidebar.json';
import { withMermaid } from 'vitepress-plugin-mermaid';

const config = defineConfig({
  srcExclude      : ['README.md', 'packages/**/README.md'],
  ignoreDeadLinks : [
    (url) => url.includes('/_media/'),
    (url) => url.endsWith('/README') || url.endsWith('/README.md')
  ],
  lang            : 'en-US',
  base            : '/did-btcr2-js',
  title           : 'DID BTCR2 JS',
  description     : 'Monorepo for did:btcr2 js/ts implementation and supporting packages.',
  cleanUrls       : true,
  mermaid: {
    securityLevel: 'loose',
    theme: 'default'
  },
  mermaidPlugin: {
    class: 'mermaid'
  },
  themeConfig     : {
    outline : {
      level : [2, 3]
    },
    externalLinkIcon : true,
    search           : {
      provider : 'local'
    },
    nav : [
      { text: 'Home', link: '/' },
      { text: 'Installation', link: '/installation' },
      { text: 'Change Log', link: '/change-log' },
    ],

    sidebar : [
      {
        text  : 'Getting Started',
        link  : '/getting-started',
        items : [
          { text: 'Installation', link: '/installation' },
          { text: 'Configuration', link: '/configuration' },
          { text: 'Usage', link: '/usage' },
          { text: 'Diagrams', link: '/diagrams' },
        ],
      },
      {
        text  : 'Packages',
        items : typedocSidebar
      }
    ],

    socialLinks : [{ icon: 'github', link: 'https://github.com/dcdpr/did-btcr2-js' }],
  }
});

export default withMermaid(config);