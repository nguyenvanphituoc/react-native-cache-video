import RNFetchBlob from 'react-native-blob-util';
import { getExtensionIfNeed } from './util';

import type { Encoding } from 'react-native-blob-util';

// RNFS
const FSManager = RNFetchBlob.fs;
//
export enum FileBucket {
  cache = 'react-native-cache-video/',
}

export class FileSystemManager {
  private static _instance: FileSystemManager;

  // support only one track
  constructor() {
    this.configuration();
    //
    this.getBucketFolder.bind(this);
    this.forEachBucket.bind(this);
    this.containInBucket.bind(this);
    this.configuration.bind(this);
    this.clearDirectory.bind(this);
    this.clearBucket.bind(this);
    // this.readDir.bind(this);
    // cache section
    this.read = this.read.bind(this);
    this.write = this.write.bind(this);
    this.copyfile.bind(this);
    this.unlinkFile.bind(this);
    this.getStatistic.bind(this);
    //
  }

  static get shared() {
    return this._instance || (this._instance = new this());
  }

  getBucketFolder(bucket?: FileBucket) {
    let cacheFolder = FSManager.dirs.CacheDir;
    let documentFolder = FSManager.dirs.DocumentDir;
    let delimiter = '/';

    // if (tempFolder[tempFolder.length - 1] !== delimiter) {
    //   tempFolder = tempFolder + delimiter;
    // }
    if (cacheFolder[cacheFolder.length - 1] !== delimiter) {
      cacheFolder = cacheFolder + delimiter;
    }
    if (documentFolder[documentFolder.length - 1] !== delimiter) {
      documentFolder = documentFolder + delimiter;
    }

    switch (bucket) {
      case FileBucket.cache:
        return `${cacheFolder}${bucket}`;
      default:
        return cacheFolder;
    }
  }

  forEachBucket(callBack: (directory: string) => void) {
    const buckets = [FileBucket.cache];
    const workingFolder = buckets.map((type) => this.getBucketFolder(type));

    workingFolder.forEach(callBack);
  }

  containInBucket(fileUri: string) {
    let isContain = false;
    this.forEachBucket((directory) => {
      isContain = isContain || fileUri.includes(directory);
    });

    return isContain;
  }

  async configuration() {
    this.forEachBucket(async (directory) => {
      const existed = await FSManager.exists(directory);
      if (!existed) {
        return FSManager.mkdir(directory);
      }
    });
  }

  async clearDirectory(bucket: string) {
    await FSManager.unlink(bucket);
    await FSManager.mkdir(bucket);
  }

  async clearBucket(bucket: FileBucket) {
    const bucketFolder = this.getBucketFolder(bucket);
    await this.clearDirectory(bucketFolder);
  }

  // async readDir(dir: string) {
  //   const files = await FileSystemManager.readDir(dir);
  //   return files;
  // }

  async copyfile(fromPath: string, toBucket: FileBucket) {
    if (fromPath) {
      const fileExtension = getExtensionIfNeed(fromPath, null);
      const timestamp = new Date().getTime();
      const folderUrl = this.getBucketFolder(toBucket);

      const fileName = `file_${timestamp}.${fileExtension}`;
      const desUrl = `${folderUrl}${fileName}`;

      await FSManager.cp(fromPath, desUrl);
      await this.unlinkFile(fromPath);
      //

      return 'file://' + desUrl;
    }

    return fromPath;
  }

  async unlinkFile(fromPath?: string) {
    if (fromPath) {
      await FSManager.unlink(fromPath);
    }
  }

  async getStatistic(fromUrl?: string) {
    if (fromUrl) {
      const stat = await FSManager.stat(fromUrl);
      return stat;
    }
    return {} as Awaited<ReturnType<typeof FSManager.stat>>;
  }

  async existsFile(forFile: string): Promise<boolean> {
    // let key = cacheKey(forKey, folder);
    // check exist and ignore timestamp path
    // key format: /cache/prefix-fileName-timestamp.ext
    // code below will check the file exist or not
    try {
      const stats = await FSManager.stat(forFile);
      if (stats.type === 'file') {
        return true;
      }
    } catch (error) {
      // It should be false too
      // failed to stat path because it does not exist or it is not a folder
      // console.debug(
      //   'react-native-cache-video.fileProvider.existsFile: ',
      //   error
      // );
      return false;
    }

    return false;
  }

  async read(
    resourceURL: string,
    format: Encoding = 'base64'
  ): Promise<string> {
    try {
      if (await this.existsFile(resourceURL)) {
        const content = await FSManager.readFile(resourceURL, format);
        return content;
      }

      return '';
    } catch (error) {
      throw error;
    }
  }

  async write(
    resourceURL: string,
    content: string,
    format: Encoding = 'base64'
  ): Promise<void> {
    // write if needed
    // case 1: file not exist
    // case 2: file exist but overwrite because expired
    try {
      await FSManager.writeFile(resourceURL, content, format);
    } catch (error) {
      throw error;
    }
  }
}
