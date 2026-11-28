/** Entry of the bundled server (dist/mcp/server.cjs and server/index.cjs in the .mcpb): always starts serving. */
import { hasVault, serve } from './server.js'

if (!hasVault()) process.stderr.write('aether-mcp: no vault folder given; tools will report it.\n')
serve()
