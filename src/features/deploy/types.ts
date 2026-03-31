export type DeploymentScope = 'global' | 'workspace';
export type DeploymentAuthType = 'system' | 'password' | 'privateKey';

export interface DeploymentAction {
	id: string;
	name: string;
	command: string;
	confirm: boolean;
	timeoutSeconds: number;
}

export interface DeploymentServerProfile {
	id: string;
	name: string;
	groupPath?: string;
	note?: string;
	host: string;
	port: number;
	username: string;
	authType: DeploymentAuthType;
	remoteRoot: string;
	actions: DeploymentAction[];
	secretEnvKeys: string[];
}

export interface DeploymentServersState {
	globalServers: DeploymentServerProfile[];
	workspaceServers: DeploymentServerProfile[];
}

export interface DeploymentWorkspaceTarget {
	id: string;
	name: string;
	serverId: string;
	remoteRoot: string;
	actions: DeploymentAction[];
	defaultActionId?: string;
}

export interface ScopedDeploymentServer extends DeploymentServerProfile {
	scope: DeploymentScope;
}

export interface DeploymentSecretEnvDraft {
	key: string;
	value: string;
	hasStoredValue: boolean;
	originalKey?: string;
}

export interface DeploymentPasswordDraft {
	value: string;
	hasStoredValue: boolean;
}

export interface DeploymentPrivateKeyDraft {
	value: string;
	hasStoredValue: boolean;
}

export interface DeploymentSecretSnapshot {
	password?: string;
	privateKey?: string;
	env: Record<string, string>;
}