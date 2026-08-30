import { Command } from 'commander'

const program = new Command()
  .name('clip')
  .description('Clip raw videos according to manifest.json (re1999-hvideos)')
  .version('0.1.0')

program
  .command('run')
  .description('Run all clips in the manifest')
  .option('-m, --manifest <path>', 'manifest JSON path', 'manifest.json')
  .option('--copy', 'draft mode: stream-copy, cut points snap to keyframes')
  .action((options: { manifest: string, copy?: boolean }) => {
    console.log('clip run:', options)
  })

program.parse()