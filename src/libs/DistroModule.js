import Asset from './Asset';

export default class DistroModule extends Asset {
  /**
   * Create a DistroModule. This is for processing,
   * not equivalent to the module objects in the
   * distro index.
   *
   * @param {any} id The id of the asset.
   * @param {string} hash The hash value of the asset.
   * @param {number} size The size in bytes of the asset.
   * @param {string} from The url where the asset can be found.
   * @param {string} to The absolute local file path of the asset.
   * @param {string} type The the module type.
   */

  constructor(id, hash, size, from, to, type) {
    super(id, hash, size, from, to);
    this.type = type;
  }
}