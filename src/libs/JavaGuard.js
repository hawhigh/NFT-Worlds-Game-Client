import fs from 'fs-extra';
import path from 'path';
import childProcess from 'child_process';
import request from 'request';
import EventEmitter from 'events';
import Registry from 'winreg';
import MinecraftUtil from './MinecraftUtil';

export default class JavaGuard extends EventEmitter {
  constructor() {
    super();
    this.mcVersion = '1.12.2'; //'1.17.1'; // hardcode version, we lock to 1.17.1
  }

  // /**
  //  * @typedef OracleJREData
  //  * @property {string} uri The base uri of the JRE.
  //  * @property {{major: string, update: string, build: string}} version Object containing version information.
  //  */

  // /**
  //  * Resolves the latest version of Oracle's JRE and parses its download link.
  //  *
  //  * @returns {Promise.<OracleJREData>} Promise which resolved to an object containing the JRE download data.
  //  */
  // static _latestJREOracle(){

  //     const url = 'https://www.oracle.com/technetwork/java/javase/downloads/jre8-downloads-2133155.html'
  //     const regex = /https:\/\/.+?(?=\/java)\/java\/jdk\/([0-9]+u[0-9]+)-(b[0-9]+)\/([a-f0-9]{32})?\/jre-\1/
  //     return new Promise((resolve, reject) => {
  //         request(url, (err, resp, body) => {
  //             if(!err){
  //                 const arr = body.match(regex)
  //                 const verSplit = arr[1].split('u')
  //                 resolve({
  //                     uri: arr[0],
  //                     version: {
  //                         major: verSplit[0],
  //                         update: verSplit[1],
  //                         build: arr[2]
  //                     }
  //                 })
  //             } else {
  //                 resolve(null)
  //             }
  //         })
  //     })
  // }

  /**
   * @typedef OpenJDKData
   * @property {string} uri The base uri of the JRE.
   * @property {number} size The size of the download.
   * @property {string} name The name of the artifact.
   */

  /**
   * Fetch the last open JDK binary.
   *
   * HOTFIX: Uses Corretto 8 for macOS.
   * See: https://github.com/dscalzi/HeliosLauncher/issues/70
   * See: https://github.com/AdoptOpenJDK/openjdk-support/issues/101
   *
   * @param {string} major The major version of Java to fetch.
   *
   * @returns {Promise.<OpenJDKData>} Promise which resolved to an object containing the JRE download data.
   */

  static _latestOpenJDK(major = '8') {
    if (process.platform === 'darwin') {
      return this._latestCorretto(major);
    } else {
      return this._latestAdoptOpenJDK(major);
    }
  }

  static _latestAdoptOpenJDK(major) {
    const sanitizedOS = process.platform === 'win32' ? 'windows' : (process.platform === 'darwin' ? 'mac' : process.platform);
    const url = `https://api.adoptopenjdk.net/v2/latestAssets/nightly/openjdk${major}?os=${sanitizedOS}&arch=x64&heap_size=normal&openjdk_impl=hotspot&type=jre`;

    return new Promise((resolve, reject) => {
      request({ url, json: true }, (err, resp, body) => {
        if (!err && body.length > 0) {
          resolve({
            uri: body[0].binary_link,
            size: body[0].binary_size,
            name: body[0].binary_name,
          });
        } else {
          resolve(null);
        }
      });
    });
  }

  static _latestCorretto(major) {
    let sanitizedOS, ext;

    switch (process.platform) {
      case 'win32':
        sanitizedOS = 'windows';
        ext = 'zip';
        break;

      case 'darwin':
        sanitizedOS = 'macos';
        ext = 'tar.gz';
        break;

      case 'linux':
        sanitizedOS = 'linux';
        ext = 'tar.gz';
        break;

      default:
        sanitizedOS = process.platform;
        ext = 'tar.gz';
        break;
    }

    const url = `https://corretto.aws/downloads/latest/amazon-corretto-${major}-x64-${sanitizedOS}-jdk.${ext}`;

    return new Promise((resolve, reject) => {
      request.head({ url, json: true }, (err, resp) => {
        if (!err && resp.statusCode === 200) {
          resolve({
            uri: url,
            size: parseInt(resp.headers['content-length']),
            name: url.substr(url.lastIndexOf('/') + 1),
          });
        } else {
          resolve(null);
        }
      });
    });
  }

  /**
   * Returns the path of the OS-specific executable for the given Java
   * installation. Supported OS's are win32, darwin, linux.
   *
   * @param {string} rootDir The root directory of the Java installation.
   * @returns {string} The path to the Java executable.
   */

  static javaExecFromRoot(rootDir) {
    if (process.platform === 'win32') {
      return path.join(rootDir, 'bin', 'javaw.exe');
    } else if (process.platform === 'darwin') {
      return path.join(rootDir, 'Contents', 'Home', 'bin', 'java');
    } else if (process.platform === 'linux') {
      return path.join(rootDir, 'bin', 'java');
    }

    return rootDir;
  }

  /**
   * Check to see if the given path points to a Java executable.
   *
   * @param {string} pth The path to check against.
   * @returns {boolean} True if the path points to a Java executable, otherwise false.
   */

  static isJavaExecPath(pth) {
    if (process.platform === 'win32') {
      return pth.endsWith(path.join('bin', 'javaw.exe'));
    } else if (process.platform === 'darwin') {
      return pth.endsWith(path.join('bin', 'java'));
    } else if (process.platform === 'linux') {
      return pth.endsWith(path.join('bin', 'java'));
    }

    return false;
  }

  /**
   * Load Mojang's launcher.json file.
   *
   * @returns {Promise.<Object>} Promise which resolves to Mojang's launcher.json object.
   */

  static loadMojangLauncherData() {
    return new Promise((resolve, reject) => {
      request.get('https://launchermeta.mojang.com/mc/launcher.json', (err, resp, body) => {
        if (err) {
          resolve(null);
        } else {
          resolve(JSON.parse(body));
        }
      });
    });
  }

  /**
   * Parses a **full** Java Runtime version string and resolves
   * the version information. Dynamically detects the formatting
   * to use.
   *
   * @param {string} verString Full version string to parse.
   * @returns Object containing the version information.
   */

  static parseJavaRuntimeVersion(verString) {
    const major = verString.split('.')[0];

    if (major == 1) {
      return JavaGuard._parseJavaRuntimeVersion8(verString);
    } else {
      return JavaGuard._parseJavaRuntimeVersion9(verString);
    }
  }

  /**
   * Parses a **full** Java Runtime version string and resolves
   * the version information. Uses Java 8 formatting.
   *
   * @param {string} verString Full version string to parse.
   * @returns Object containing the version information.
   */

  static _parseJavaRuntimeVersion8(verString) {
    // 1.{major}.0_{update}-b{build}
    // ex. 1.8.0_152-b16
    const ret = {};
    let pts = verString.split('-');

    ret.build = parseInt(pts[1].substring(1));
    pts = pts[0].split('_');
    ret.update = parseInt(pts[1]);
    ret.major = parseInt(pts[0].split('.')[1]);

    return ret;
  }

  /**
   * Parses a **full** Java Runtime version string and resolves
   * the version information. Uses Java 9+ formatting.
   *
   * @param {string} verString Full version string to parse.
   * @returns Object containing the version information.
   */

  static _parseJavaRuntimeVersion9(verString) {
    // {major}.{minor}.{revision}+{build}
    // ex. 10.0.2+13
    const ret = {};
    let pts = verString.split('+');

    ret.build = parseInt(pts[1]);
    pts = pts[0].split('.');
    ret.major = parseInt(pts[0]);
    ret.minor = parseInt(pts[1]);
    ret.revision = parseInt(pts[2]);

    return ret;
  }

  /**
   * Validates the output of a JVM's properties. Currently validates that a JRE is x64
   * and that the major = 8, update > 52.
   *
   * @param {string} stderr The output to validate.
   *
   * @returns {Promise.<Object>} A promise which resolves to a meta object about the JVM.
   * The validity is stored inside the `valid` property.
   */

  _validateJVMProperties(stderr) {
    const res = stderr;
    const props = res.split('\n');

    const goal = 2;
    let checksum = 0;

    const meta = {};

    for (let i = 0; i < props.length; i++) {
      if (props[i].indexOf('sun.arch.data.model') > -1) {
        let arch = props[i].split('=')[1].trim();

        arch = parseInt(arch);

        console.log(props[i].trim());

        if (arch === 64) {
          meta.arch = arch;
          ++checksum;

          if (checksum === goal) {
            break;
          }
        }
      } else if (props[i].indexOf('java.runtime.version') > -1) {
        const verString = props[i].split('=')[1].trim();

        console.log(props[i].trim());

        const verOb = JavaGuard.parseJavaRuntimeVersion(verString);

        if (verOb.major < 9) {
          // Java 8
          if (verOb.major === 8 && verOb.update > 52) {
            meta.version = verOb;
            ++checksum;

            if (checksum === goal) {
              break;
            }
          }
        } else {
          // Java 9+
          if (MinecraftUtil.mcVersionAtLeast('1.13', this.mcVersion)) {
            console.log('Java 9+ not yet tested.');
            /* meta.version = verOb
               ++checksum
               if (checksum === goal) {
                break;
               } */
          }
        }
      } else if (props[i].lastIndexOf('java.vendor ') > -1) {
        const vendorName = props[i].split('=')[1].trim();
        console.log(props[i].trim());
        meta.vendor = vendorName;
      }
    }

    meta.valid = checksum === goal;

    return meta;
  }

  /**
   * Validates that a Java binary is at least 64 bit. This makes use of the non-standard
   * command line option -XshowSettings:properties. The output of this contains a property,
   * sun.arch.data.model = ARCH, in which ARCH is either 32 or 64. This option is supported
   * in Java 8 and 9. Since this is a non-standard option. This will resolve to true if
   * the function's code throws errors. That would indicate that the option is changed or
   * removed.
   *
   * @param {string} binaryExecPath Path to the java executable we wish to validate.
   *
   * @returns {Promise.<Object>} A promise which resolves to a meta object about the JVM.
   * The validity is stored inside the `valid` property.
   */

  _validateJavaBinary(binaryExecPath) {
    return new Promise((resolve, reject) => {
      if (!JavaGuard.isJavaExecPath(binaryExecPath)) {
        resolve({ valid: false });
      } else if (fs.existsSync(binaryExecPath)) {
        // Workaround (javaw.exe no longer outputs this information.)
        console.log(typeof binaryExecPath);

        if (binaryExecPath.indexOf('javaw.exe') > -1) {
          binaryExecPath.replace('javaw.exe', 'java.exe');
        }

        childProcess.exec('"' + binaryExecPath + '" -XshowSettings:properties', (err, stdout, stderr) => {
          if (err) {
            console.log(err);
          }

          try {
            // Output is stored in stderr?
            resolve(this._validateJVMProperties(stderr));
          } catch (err) {
            // Output format might have changed, validation cannot be completed.
            resolve({ valid: false });
          }
        });
      } else {
        resolve({ valid: false });
      }
    });
  }

  /**
   * Checks for the presence of the environment variable JAVA_HOME. If it exits, we will check
   * to see if the value points to a path which exists. If the path exits, the path is returned.
   *
   * @returns {string} The path defined by JAVA_HOME, if it exists. Otherwise null.
   */

  static _scanJavaHome() {
    const jHome = process.env.JAVA_HOME;

    try {
      const res = fs.existsSync(jHome);

      return res ? jHome : null;
    } catch (err) {
      // Malformed JAVA_HOME property.
      return null;
    }
  }

  /**
   * Scans the registry for 64-bit Java entries. The paths of each entry are added to
   * a set and returned. Currently, only Java 8 (1.8) is supported.
   *
   * @returns {Promise.<Set.<string>>} A promise which resolves to a set of 64-bit Java root
   * paths found in the registry.
   */

  static _scanRegistry() {
    return new Promise((resolve, reject) => {
      // Keys for Java v9.0.0 and later:
      // 'SOFTWARE\\JavaSoft\\JRE'
      // 'SOFTWARE\\JavaSoft\\JDK'
      // Forge does not yet support Java 9, therefore we do not.

      // Keys for Java 1.8 and prior:
      const regKeys = [
        '\\SOFTWARE\\JavaSoft\\Java Runtime Environment',
        '\\SOFTWARE\\JavaSoft\\Java Development Kit',
      ];

      let keysDone = 0;

      const candidates = new Set();

      for (let i = 0; i < regKeys.length; i++) {
        const key = new Registry({
          hive: Registry.HKLM,
          key: regKeys[i],
          arch: 'x64',
        });

        key.keyExists((err, exists) => {
          if (err) {
            console.log(err);
          }

          if (exists) {
            key.keys((err, javaVers) => {
              if (err) {
                keysDone++;

                console.error(err);

                // REG KEY DONE
                // DUE TO ERROR
                if (keysDone === regKeys.length) {
                  resolve(candidates);
                }
              } else {
                if (javaVers.length === 0) {
                  // REG KEY DONE
                  // NO SUBKEYS
                  keysDone++;

                  if (keysDone === regKeys.length) {
                    resolve(candidates);
                  }
                } else {
                  let numDone = 0;

                  for (let j = 0; j < javaVers.length; j++) {
                    const javaVer = javaVers[j];
                    const vKey = javaVer.key.substring(javaVer.key.lastIndexOf('\\') + 1);

                    // Only Java 8 is supported currently.
                    if (parseFloat(vKey) === 1.8) {
                      javaVer.get('JavaHome', (err, res) => {
                        if (err) { console.log(err); }

                        const jHome = res.value;

                        if (jHome.indexOf('(x86)') === -1) {
                          candidates.add(jHome);
                        }

                        // SUBKEY DONE
                        numDone++;

                        if (numDone === javaVers.length) {
                          keysDone++;

                          if (keysDone === regKeys.length) {
                            resolve(candidates);
                          }
                        }
                      });
                    } else {
                      // SUBKEY DONE
                      // NOT JAVA 8
                      numDone++;

                      if (numDone === javaVers.length) {
                        keysDone++;

                        if (keysDone === regKeys.length) {
                          resolve(candidates);
                        }
                      }
                    }
                  }
                }
              }
            });
          } else {
            // REG KEY DONE
            // DUE TO NON-EXISTANCE
            keysDone++;

            if (keysDone === regKeys.length) {
              resolve(candidates);
            }
          }
        });
      }
    });
  }

  /**
   * See if JRE exists in the Internet Plug-Ins folder.
   *
   * @returns {string} The path of the JRE if found, otherwise null.
   */
  static _scanInternetPlugins() {
    // /Library/Internet Plug-Ins/JavaAppletPlugin.plugin/Contents/Home/bin/java
    const pth = '/Library/Internet Plug-Ins/JavaAppletPlugin.plugin';
    const res = fs.existsSync(JavaGuard.javaExecFromRoot(pth));

    return res ? pth : null;
  }

  /**
   * Scan a directory for root JVM folders.
   *
   * @param {string} scanDir The directory to scan.
   * @returns {Promise.<Set.<string>>} A promise which resolves to a set of the discovered
   * root JVM folders.
   */
  static async _scanFileSystem(scanDir) {
    const res = new Set();

    if (await fs.pathExists(scanDir)) {
      const files = await fs.readdir(scanDir);

      for (let i = 0; i < files.length; i++) {
        const combinedPath = path.join(scanDir, files[i]);
        const execPath = JavaGuard.javaExecFromRoot(combinedPath);

        if (await fs.pathExists(execPath)) {
          res.add(combinedPath);
        }
      }
    }

    return res;
  }

  /**
   *
   * @param {Set.<string>} rootSet A set of JVM root strings to validate.
   * @returns {Promise.<Object[]>} A promise which resolves to an array of meta objects
   * for each valid JVM root directory.
   */

  async _validateJavaRootSet(rootSet) {
    const rootArr = Array.from(rootSet);
    const validArr = [];

    for (let i = 0; i < rootArr.length; i++) {
      const execPath = JavaGuard.javaExecFromRoot(rootArr[i]);
      const metaOb = await this._validateJavaBinary(execPath);

      if (metaOb.valid) {
        metaOb.execPath = execPath;
        validArr.push(metaOb);
      }
    }

    return validArr;
  }

  /**
   * Sort an array of JVM meta objects. Best candidates are placed before all others.
   * Sorts based on version and gives priority to JREs over JDKs if versions match.
   *
   * @param {Object[]} validArr An array of JVM meta objects.
   * @returns {Object[]} A sorted array of JVM meta objects.
   */

  static _sortValidJavaArray(validArr) {
    const retArr = validArr.sort((a, b) => {
      if (a.version.major === b.version.major) {
        if (a.version.major < 9) {
          // Java 8
          if (a.version.update === b.version.update) {
            if (a.version.build === b.version.build) {
              // Same version, give priority to JRE.
              if (a.execPath.toLowerCase().indexOf('jdk') > -1) {
                return b.execPath.toLowerCase().indexOf('jdk') > -1 ? 0 : 1;
              } else {
                return -1;
              }
            } else {
              return a.version.build > b.version.build ? -1 : 1;
            }
          } else {
            return a.version.update > b.version.update ? -1 : 1;
          }
        } else {
          // Java 9+
          if (a.version.minor === b.version.minor) {
            if (a.version.revision === b.version.revision) {
              // Same version, give priority to JRE.
              if (a.execPath.toLowerCase().indexOf('jdk') > -1) {
                return b.execPath.toLowerCase().indexOf('jdk') > -1 ? 0 : 1;
              } else {
                return -1;
              }
            } else {
              return a.version.revision > b.version.revision ? -1 : 1;
            }
          } else {
            return a.version.minor > b.version.minor ? -1 : 1;
          }
        }
      } else {
        return a.version.major > b.version.major ? -1 : 1;
      }
    });

    return retArr;
  }

  /**
   * Attempts to find a valid x64 installation of Java on Windows machines.
   * Possible paths will be pulled from the registry and the JAVA_HOME environment
   * variable. The paths will be sorted with higher versions preceeding lower, and
   * JREs preceeding JDKs. The binaries at the sorted paths will then be validated.
   * The first validated is returned.
   *
   * Higher versions > Lower versions
   * If versions are equal, JRE > JDK.
   *
   * @param {string} dataDir The base launcher directory.
   * @returns {Promise.<string>} A Promise which resolves to the executable path of a valid
   * x64 Java installation. If none are found, null is returned.
   */

  async _win32JavaValidate(dataDir) {
    // Get possible paths from the registry.
    let pathSet1 = await JavaGuard._scanRegistry();

    if (pathSet1.size === 0) {
      // Do a manual file system scan of program files.
      pathSet1 = new Set([
        ...pathSet1,
        ...(await JavaGuard._scanFileSystem('C:\\Program Files\\Java')),
        ...(await JavaGuard._scanFileSystem('C:\\Program Files\\AdoptOpenJDK')),
      ]);
    }

    // Get possible paths from the data directory.
    const pathSet2 = await JavaGuard._scanFileSystem(path.join(dataDir, 'runtime', 'x64'));

    // Merge the results.
    const uberSet = new Set([ ...pathSet1, ...pathSet2 ]);

    // Validate JAVA_HOME.
    const jHome = JavaGuard._scanJavaHome();

    if (jHome != null && jHome.indexOf('(x86)') === -1) {
      uberSet.add(jHome);
    }

    let pathArr = await this._validateJavaRootSet(uberSet);
    pathArr = JavaGuard._sortValidJavaArray(pathArr);

    if (pathArr.length > 0) {
      return pathArr[0].execPath;
    } else {
      return null;
    }
  }

  /**
   * Attempts to find a valid x64 installation of Java on MacOS.
   * The system JVM directory is scanned for possible installations.
   * The JAVA_HOME enviroment variable and internet plugins directory
   * are also scanned and validated.
   *
   * Higher versions > Lower versions
   * If versions are equal, JRE > JDK.
   *
   * @param {string} dataDir The base launcher directory.
   * @returns {Promise.<string>} A Promise which resolves to the executable path of a valid
   * x64 Java installation. If none are found, null is returned.
   */

  async _darwinJavaValidate(dataDir) {
    const pathSet1 = await JavaGuard._scanFileSystem('/Library/Java/JavaVirtualMachines');
    const pathSet2 = await JavaGuard._scanFileSystem(path.join(dataDir, 'runtime', 'x64'));

    const uberSet = new Set([ ...pathSet1, ...pathSet2 ]);

    // Check Internet Plugins folder.
    const iPPath = JavaGuard._scanInternetPlugins();

    if (iPPath != null) {
      uberSet.add(iPPath);
    }

    // Check the JAVA_HOME environment variable.
    let jHome = JavaGuard._scanJavaHome();

    if (jHome != null) {
      // Ensure we are at the absolute root.
      if (jHome.contains('/Contents/Home')) {
        jHome = jHome.substring(0, jHome.indexOf('/Contents/Home'));
      }

      uberSet.add(jHome);
    }

    let pathArr = await this._validateJavaRootSet(uberSet);
    pathArr = JavaGuard._sortValidJavaArray(pathArr);

    if (pathArr.length > 0) {
      return pathArr[0].execPath;
    } else {
      return null;
    }
  }

  /**
   * Attempts to find a valid x64 installation of Java on Linux.
   * The system JVM directory is scanned for possible installations.
   * The JAVA_HOME enviroment variable is also scanned and validated.
   *
   * Higher versions > Lower versions
   * If versions are equal, JRE > JDK.
   *
   * @param {string} dataDir The base launcher directory.
   * @returns {Promise.<string>} A Promise which resolves to the executable path of a valid
   * x64 Java installation. If none are found, null is returned.
   */

  async _linuxJavaValidate(dataDir) {
    const pathSet1 = await JavaGuard._scanFileSystem('/usr/lib/jvm');
    const pathSet2 = await JavaGuard._scanFileSystem(path.join(dataDir, 'runtime', 'x64'));

    const uberSet = new Set([ ...pathSet1, ...pathSet2 ]);

    // Validate JAVA_HOME
    const jHome = JavaGuard._scanJavaHome();

    if (jHome != null) {
      uberSet.add(jHome);
    }

    let pathArr = await this._validateJavaRootSet(uberSet);
    pathArr = JavaGuard._sortValidJavaArray(pathArr);

    if (pathArr.length > 0) {
      return pathArr[0].execPath;
    } else {
      return null;
    }
  }

  /**
   * Retrieve the path of a valid x64 Java installation.
   *
   * @param {string} dataDir The base launcher directory.
   * @returns {string} A path to a valid x64 Java installation, null if none found.
   */

  async validateJava(dataDir) {
    return await this['_' + process.platform + 'JavaValidate'](dataDir);
  }
}