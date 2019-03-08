# Node.js 8.1 AWS ES8 lambda with S3 and EC2 connectivity
This is an example lambda that can be used to delete folder objects from a S3 bucket which are not referenced by an EC2 instance.  The lambda looks in EC2 CoreApp deployments to see read a tag called appVersion which is used to determine the deployed app version.  This version is then cross referenced in the S3 folder objects to determine if there is a corresponding S3 folder deployment. If there is no corresponding S3 folder deployment and that folder object is more than n days old, it is a delete candidate.  

This lambda is written in ES8(es2017) with async, await, map, reduce and filter functions, running on Node.js 8.10.

The lambda can be either run in list or delete mode.  To list candidate folder objects action:list.  To delete  candidate folder objects action:delete.

# Triggering the lambda in list mode for candidate folder objects older than or equal to 30 days.
Send a paylod
```
{ "bucket": "s3-bucket-name", "action": "list", "retainDays": 30 }
```

# Triggering the lambda in delete mode for candidate folder objects older than or equal to 30 days.
Send a paylod
```
{ "bucket": "s3-bucket-name", "action": "delete", "retainDays": 30 }
```

# References
https://medium.com/poka-techblog/simplify-your-javascript-use-map-reduce-and-filter-bd02c593cc2d
https://irvinlim.com/blog/async-await-on-aws-lambda/
