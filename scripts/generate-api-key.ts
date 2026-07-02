import crypto from 'crypto'

/**
 * Generates a secure, random API key suitable for the API_KEY environment variable.
 */
function generateApiKey() {
  const apiKey = crypto.randomBytes(32).toString('hex')
  
  console.log('\n🔐 API Key generated successfully:\n')
  console.log(`  ${apiKey}\n`)
  console.log('To use this key:')
  console.log('1. Add it to your .env file as API_KEY=' + apiKey)
  console.log('2. Pass it in your requests using either:')
  console.log('   Header: x-api-key: ' + apiKey)
  console.log('   Header: Authorization: Bearer ' + apiKey)
  console.log('\n⚠️  Store this key safely! It provides system-level access to the API.\n')
}

generateApiKey()
