const AWS = require('aws-sdk');
const EC2 = new AWS.EC2();
const S3 = new AWS.S3();
const s3WebRoot = 'pexa_web/resources/';
const knownWebFolders = [`${s3WebRoot}applet/`, `${s3WebRoot}dist/`, `${s3WebRoot}dojo/`, `${s3WebRoot}error/`, `${s3WebRoot}http_errors/`, `${s3WebRoot}image/`, `${s3WebRoot}images/`];
let bucket = 'pexa-static-np';
let action = 'list';
let retainDays = 30;

/**
 * This lambda is used to clean up old static web resources that are no longer referenced by any app server deployment. To trigger the lambda
 * send a payload { "bucket": "pexa-static-np", "action": "list", "retainDays": 30 }.  Use action:list to list the folder objects that this lambda
 * will operate on. Use action:delete to delete the folder objects.  Use retainDays:1 to delete all unused folder objects without considering an
 * expiry date.
 *
 **/
exports.handler = async (event, context, callback) => {
    try {
        //configure based on trigger event
        parseEvents(event);
        const allS3Folders = await getDeployedS3Folders(s3WebRoot);
        const s3DeployedFolderVersions = await filterKnownWebFolders(allS3Folders);
        const inUseAppVersions = await getDeployedCoreAppVersions();
        const s3FoldersToBeDeleted = await getS3FoldersToBeDeleted(s3DeployedFolderVersions, inUseAppVersions);
        const s3ExpiredFolders = await getExpiredFolders(s3FoldersToBeDeleted);
        //will only delete if the event action is delete and there are expired folders.
        await deleteFolders(s3ExpiredFolders);

        callback(null, `Bucket:${bucket} Action:${action} ${s3ExpiredFolders.length} ${s3ExpiredFolders.toString()}`);
    } catch (err) {
        console.error('Error:', err);
        callback(err.message);
    }
};

const parseEvents = (event) => {
    if (!event) {
        throw new Error(`Error: event is not defined`);
    }

    bucket = event.bucket || 'pexa-static-np';
    action = event.action || 'list';
    retainDays = event.retainDays || 60;

    if (!action === 'delete' || !action === 'list') {
        throw new Error(`Error: action needs to be either list or delete`);
    }
    console.log(`Starting pexa-static-np-cleanup bucket:${bucket} action:${action} retainDays:${retainDays}`);
};

const getExpiredFolders = async (foldersToBeDeleted) => {
    const expiredFolders = [];
    for (const folder of foldersToBeDeleted) {
        const modifiedDate = await getLastModifiedDate(folder);
        const timeDiff = Math.abs(new Date().getTime() - modifiedDate.getTime());
        const diffDays = Math.ceil(timeDiff / (1000 * 3600 * 24));

        if (diffDays >= retainDays) {
            expiredFolders.push(folder);
        }
    }
    return expiredFolders;
};

const getDeployedS3Folders = async (root) => {
    let params = {
        Bucket: 'pexa-static-np',
        Delimiter: '/',
        Prefix: `${root}`,
    };

    try {
        const files = await S3.listObjectsV2(params).promise();
        let folders = files.CommonPrefixes.map(function (folder) {
            return folder.Prefix;
        });
        return folders;
    } catch(err) {
        throw new Error(`S3 Deployment root directory not found:${root}`);
    }
};

const getLastModifiedDate = async (folder) => {
    let params = {
        Bucket: 'pexa-static-np',
        Delimiter: '',
        Prefix: `${folder}`,
        MaxKeys: 1
    };
    try {
        const file = await S3.listObjects(params).promise();
        return file.Contents[0].LastModified;
    } catch(err) {
        console.log("File not Found ERROR : " + err, folder);
    }
};

const filterKnownWebFolders = async (deployedS3Versions) => {

    const deployedS3Folders = deployedS3Versions.filter(function (folder) {
        return !knownWebFolders.includes(folder);
    });

    return deployedS3Folders;
};

const deleteFolders = async (folders) => {
    if (action === 'delete') {
        folders.forEach(function (folder) {
            emptyS3Folder(bucket, folder);
            console.log('Deleted:', folder);
        });
    }
};

const emptyS3Folder = async (bucketName, folder) => {
    const listParams = {
        Bucket: bucketName,
        Prefix: folder
    };

    const listedObjects = await S3.listObjectsV2(listParams).promise();

    if (listedObjects.Contents.length === 0) {
        console.log('Nothing to delete...');
        return;
    }

    const deleteParams = {
        Bucket: bucketName,
        Delete: { Objects: [] }
    };

    listedObjects.Contents.forEach(({ Key }) => {
        deleteParams.Delete.Objects.push({ Key });
    });

    try {
        await S3.deleteObjects(deleteParams).promise();
    } catch (err) {
        throw new Error(`Error deleting s3 folder ${folder}`);
    }

    if (listedObjects.IsTruncated) {
        await emptyS3Folder(bucketName, folder);
    }
};


const getS3FoldersToBeDeleted = async (s3DeployedVersions, inUseappVersions) => {

    const inUseappFolders = inUseappVersions.map(function (appVersion) {
        return appVersion.appVersion;
    });

    const toBeDeleted = s3DeployedVersions.filter(function (folder) {
        const folderRegex = new RegExp('(pexa_web\/resources\/)(.*?)(\/)', 'g');
        const match = folderRegex.exec(folder);
        return !inUseappFolders.includes(match[2]);
    });
    return toBeDeleted;
};

/**
 * Get the deployed app versions in all the coreapp stacks.
 **/
const getDeployedCoreAppVersions = async () => {

    try {
        // Get info about all instances.
        const instancesData = await EC2.describeInstances().promise();

        const appVersions = [];
        instancesData.Reservations.forEach(reservation => {
            reservation.Instances.forEach(instance => {

                let instanceName = instance.Tags.find((tag) => tag.Key === 'Name' && tag.Value === 'CoreApp');

                if (instanceName) {
                    let stackName = instance.Tags.find((tag) => tag.Key === 'aws:cloudformation:stack-name');
                    let applicationVersion = instance.Tags.find((tag) => tag.Key === 'ApplicationVersion');

                    appVersions.push({'stackName': stackName.Value, 'appVersion': applicationVersion.Value});
                }
            });
        });
        return appVersions;
    } catch (err) {
        throw new Error("Unable to determine deployed app versions, CoreApp tags not found");
    }
};