# AWS CDK stacks with all the backend and frontend resources

## Useful commands

 * `npm run install:all`                 install all necessary modules
 * `npm run build`                       compile typescript to js
 * `npm run configure`                   start the configuration script
 * `npm run sync-config`                 download frontend-config.js for local frontend testing
 * `npm run build:frontend`              build frontend applications
 * `npm run cdk:deploy`                  deploy backend and frontend stacks to your default AWS account/region
 * `npm run cdk:deploy:gitbash`          deploy backend and frontend stacks to your default AWS account/region (WINDOWS)
 * `npm run build:deploy:all`            build frontend applications and deploy stacks to your default AWS account/region
 * `npm run build:deploy:all:gitbash`    build frontend applications and deploy stacks to your default AWS account/region (WINDOWS) 

 ## What's different about the gitbash (windows) specific commands
 Building on Windows requires a few small changes that have been bundled into different gitbash specific scripts:
 * Use of `set` to configure the `NODE_ENV` environment variable - [More Information](https://stackoverflow.com/a/9250168)
 * All `cdk` commands are prefixed with `winpty` - [More Information](https://github.com/git-for-windows/git/wiki/FAQ#some-native-console-programs-dont-work-when-run-from-git-bash-how-to-fix-it)

