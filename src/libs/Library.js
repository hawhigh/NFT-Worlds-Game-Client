import Asset from './Asset';

export default class Library extends Asset {
  /**
   * Converts the process.platform OS names to match mojang's OS names.
   */

  static mojangFriendlyOS() {
    const opSys = process.platform;

    if (opSys === 'darwin') {
      return 'osx';
    } else if (opSys === 'win32') {
      return 'windows';
    } else if (opSys === 'linux') {
      return 'linux';
    } else {
      return 'unknown_os';
    }
  }

  /**
   * Checks whether or not a library is valid for download on a particular OS, following
   * the rule format specified in the mojang version data index. If the allow property has
   * an OS specified, then the library can ONLY be downloaded on that OS. If the disallow
   * property has instead specified an OS, the library can be downloaded on any OS EXCLUDING
   * the one specified.
   *
   * If the rules are undefined, the natives property will be checked for a matching entry
   * for the current OS.
   *
   * @param {Array.<Object>} rules The Library's download rules.
   * @param {Object} natives The Library's natives object.
   * @returns {boolean} True if the Library follows the specified rules, otherwise false.
   */

  static validateRules(rules, natives) {
    if (rules == null) {
      if (natives == null) {
        return true;
      } else {
        return natives[Library.mojangFriendlyOS()] != null;
      }
    }

    for (const rule of rules) {
      const action = rule.action;
      const osProp = rule.os;

      if (action != null && osProp != null) {
        const osName = osProp.name;
        const osMoj = Library.mojangFriendlyOS();

        if (action === 'allow') {
          return osName === osMoj;
        } else if (action === 'disallow') {
          return osName !== osMoj;
        }
      }
    }

    return true;
  }
}