const fs = require('fs')
const path = require('path')

exports.default = async function afterPack(context) {
  const resourcesDir = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
  const yml = `provider: github\nowner: jonnyfiive\nrepo: yardhouse\n`
  fs.writeFileSync(path.join(resourcesDir, 'app-update.yml'), yml)
  console.log('  • wrote app-update.yml to Resources')
}
