#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import {CreateSubtitleStepFunctionsStack} from '../lib/create-subtitle-step-functions-stack';
import {SharedStack} from "../lib/shared-resources-stack";
import {ApiStack} from "../lib/api-statck";
import {CognitoStack} from "../lib/cognito-stack";
import {StaticWebStack} from "../lib/static-web-stack";

const app = new cdk.App();

const {staticWebBucket, staticWebDistribution} = new StaticWebStack(app, 'StaticWebStack');

const {
    assetsBucket,
    bucketAccessPolicyStatement,
    dynamoVideoTable,
    assetsDistribution
} = new SharedStack(app, 'SharedStack', {
    staticWebDistributionDomainName: staticWebDistribution.distributionDomainName
});

const {createSubtitleStateMachine} = new CreateSubtitleStepFunctionsStack(app, 'CreateSubtitleStepFunctionsStack', {
    assetsBucket,
    bucketAccessPolicyStatement,
    dynamoVideoTable,
    assetsDistribution,
});

const {userPool} = new CognitoStack(app, 'CognitoStack', {assetsBucket});

new ApiStack(app, 'ApiStack', {
    assetsBucket,
    bucketAccessPolicyStatement,
    dynamoVideoTable,
    createSubtitleStateMachine,
    assetsDistribution,
    staticWebBucket,
    userPool,
});

app.synth();
