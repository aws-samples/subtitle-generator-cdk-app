import * as cdk from "aws-cdk-lib";
import {Construct} from "constructs";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3 from "aws-cdk-lib/aws-s3";

export interface CognitoStackProps extends cdk.StackProps {
    readonly assetsBucket: s3.Bucket;
}

export class CognitoStack extends cdk.Stack {
    public readonly userPool: cognito.UserPool;

    constructor(scope: Construct, id: string, props: CognitoStackProps) {
        super(scope, id, props);

        this.userPool = new cognito.UserPool(this, 'UserPool', {
            selfSignUpEnabled: true,
            signInAliases: {
                email: true,
                username: true,
            },
            standardAttributes: {
                email: {
                    mutable: false,
                    required: true,
                }
            },
            passwordPolicy: {
                minLength: 8,
                requireLowercase: true,
                requireDigits: true,
                requireUppercase: true,
                requireSymbols: false,
            },
            accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });

        const userPoolClient = new cognito.UserPoolClient(this, 'UserPoolClient', {
            userPool: this.userPool,
            generateSecret: false,
            authFlows: {
                userSrp: true,
            },
            supportedIdentityProviders: [
                cognito.UserPoolClientIdentityProvider.COGNITO,
            ],
        });

        const identityPool = new cognito.CfnIdentityPool(this, 'IdentityPool', {
            allowUnauthenticatedIdentities: true,
            cognitoIdentityProviders: [
                {
                    clientId: userPoolClient.userPoolClientId,
                    providerName: this.userPool.userPoolProviderName,
                },
            ],
        });

        const isAnonymousCognitoGroupRole = new iam.Role(
            this,
            'AnonymousGroupRole',
            {
                description: 'Default role for anonymous users',
                assumedBy: new iam.FederatedPrincipal(
                    'cognito-identity.amazonaws.com',
                    {
                        StringEquals: {
                            'cognito-identity.amazonaws.com:aud': identityPool.ref,
                        },
                        'ForAnyValue:StringLike': {
                            'cognito-identity.amazonaws.com:amr': 'unauthenticated',
                        },
                    },
                    'sts:AssumeRoleWithWebIdentity',
                )
            },
        );

        const isUserCognitoGroupRole = new iam.Role(this, 'UsersGroupRole', {
            description: 'Default role for authenticated users',
            assumedBy: new iam.FederatedPrincipal(
                'cognito-identity.amazonaws.com',
                {
                    StringEquals: {
                        'cognito-identity.amazonaws.com:aud': identityPool.ref,
                    },
                    'ForAnyValue:StringLike': {
                        'cognito-identity.amazonaws.com:amr': 'authenticated',
                    },
                },
                'sts:AssumeRoleWithWebIdentity',
            )
        });

        props.assetsBucket.grantReadWrite(isUserCognitoGroupRole);
        props.assetsBucket.grantDelete(isUserCognitoGroupRole);

        new cognito.CfnIdentityPoolRoleAttachment(
            this,
            'IdentityPoolRoleAttachment',
            {
                identityPoolId: identityPool.ref,
                roles: {
                    authenticated: isUserCognitoGroupRole.roleArn,
                    unauthenticated: isAnonymousCognitoGroupRole.roleArn,
                },
                roleMappings: {
                    mapping: {
                        type: 'Token',
                        ambiguousRoleResolution: 'AuthenticatedRole',
                        identityProvider: `cognito-idp.${
                            cdk.Stack.of(this).region
                        }.amazonaws.com/${this.userPool.userPoolId}:${
                            userPoolClient.userPoolClientId
                        }`,
                    },
                },
            },
        );

        new cdk.CfnOutput(this, 'UserPoolId', {
            value: this.userPool.userPoolId,
        });

        new cdk.CfnOutput(this, 'UserPoolClientId', {
            value: userPoolClient.userPoolClientId,
        });

        new cdk.CfnOutput(this, 'IdentityPoolId', {
            value: identityPool.ref,
        });

    }
}
