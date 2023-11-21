import RNFetchBlob from 'react-native-blob-util';
import { getExtensionIfNeed } from '../Utils/util';
// RNFS
const FileSystemManager = RNFetchBlob.fs;
//
export var FileBucket;
(function (FileBucket) {
    FileBucket["cache"] = "react-native-cache-video/";
})(FileBucket || (FileBucket = {}));
export class SimpleFileProvider {
    static _instance;
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
    getBucketFolder(bucket) {
        let cacheFolder = FileSystemManager.dirs.CacheDir;
        let documentFolder = FileSystemManager.dirs.DocumentDir;
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
    forEachBucket(callBack) {
        const buckets = [FileBucket.cache];
        const workingFolder = buckets.map((type) => this.getBucketFolder(type));
        workingFolder.forEach(callBack);
    }
    containInBucket(fileUri) {
        let isContain = false;
        this.forEachBucket((directory) => {
            isContain = isContain || fileUri.includes(directory);
        });
        return isContain;
    }
    async configuration() {
        this.forEachBucket(async (directory) => {
            const existed = await FileSystemManager.exists(directory);
            if (!existed) {
                return FileSystemManager.mkdir(directory);
            }
        });
    }
    async clearDirectory(bucket) {
        await FileSystemManager.unlink(bucket);
        await FileSystemManager.mkdir(bucket);
    }
    async clearBucket(bucket) {
        const bucketFolder = this.getBucketFolder(bucket);
        await this.clearDirectory(bucketFolder);
    }
    // async readDir(dir: string) {
    //   const files = await FileSystemManager.readDir(dir);
    //   return files;
    // }
    async copyfile(fromPath, toBucket) {
        if (fromPath) {
            const fileExtension = getExtensionIfNeed(fromPath, null);
            const timestamp = new Date().getTime();
            const folderUrl = this.getBucketFolder(toBucket);
            const fileName = `file_${timestamp}.${fileExtension}`;
            const desUrl = `${folderUrl}${fileName}`;
            await FileSystemManager.cp(fromPath, desUrl);
            await this.unlinkFile(fromPath);
            //
            return 'file://' + desUrl;
        }
        return fromPath;
    }
    async unlinkFile(fromPath) {
        if (fromPath) {
            await FileSystemManager.unlink(fromPath);
        }
    }
    async getStatistic(fromUrl) {
        if (fromUrl) {
            const stat = await FileSystemManager.stat(fromUrl);
            return stat;
        }
        return {};
    }
    async existsFile(forFile) {
        // let key = cacheKey(forKey, folder);
        // check exist and ignore timestamp path
        // key format: /cache/prefix-fileName-timestamp.ext
        // code below will check the file exist or not
        try {
            const stats = await FileSystemManager.stat(forFile);
            if (stats.type === 'file') {
                return true;
            }
        }
        catch (error) {
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
    async read(resourceURL, format = 'base64') {
        try {
            if (await this.existsFile(resourceURL)) {
                const content = await FileSystemManager.readFile(resourceURL, format);
                return content;
            }
            return '';
        }
        catch (error) {
            throw error;
        }
    }
    async write(resourceURL, content, format = 'base64') {
        // write if needed
        // case 1: file not exist
        // case 2: file exist but overwrite because expired
        try {
            await FileSystemManager.writeFile(resourceURL, content, format);
        }
        catch (error) {
            throw error;
        }
    }
}
