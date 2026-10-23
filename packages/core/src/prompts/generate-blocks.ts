import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { generateBlocksModule } from './blocks-source.ts'

const target = new URL('./blocks.generated.ts', import.meta.url)
writeFileSync(target, generateBlocksModule(new URL('../../prompts/', import.meta.url)))
console.log(`wrote ${fileURLToPath(target)}`)
