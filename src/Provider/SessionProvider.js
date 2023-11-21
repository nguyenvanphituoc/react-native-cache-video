import RNFetchBlob from 'react-native-blob-util';
import { KEY_PREFIX } from '../Utils/constants';
export * from 'react-native-blob-util';
export class SimpleSessionProvider {
    // current caching m3u8 playlist
    // any are session task object
    downloadingList = {};
    dataTask = (url, options, callback) => {
        const downloadTask = RNFetchBlob.config({
            session: KEY_PREFIX,
            ...options,
        }).fetch('GET', url, {
            'RNFB-Response': 'base64',
        });
        // mark it as downloading
        this.downloadingList[url] = downloadTask;
        // listen response download
        downloadTask
            .then((res) => {
            callback && callback(res.data, res, undefined);
        })
            .catch((error) => {
            callback && callback(null, null, error);
        })
            .finally(() => {
            delete this.downloadingList[url];
        });
        //
        return downloadTask;
    };
    cancelTask = (url) => {
        const downloadTask = this.downloadingList[url];
        if (!downloadTask) {
            return;
        }
        downloadTask.cancel();
        delete this.downloadingList[url];
    };
    cancelAllTask = () => {
        Object.entries(this.downloadingList).forEach(([url, downloadTask]) => {
            url && downloadTask?.cancel();
        });
        this.downloadingList = {};
    };
}
