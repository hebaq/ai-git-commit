import { CONFIG_NAMESPACE, PROVIDER_MANAGEMENT_VIEW_CONTAINER_ID } from '../gitCommit/constants';

export const DEPLOYMENT_GLOBAL_SERVERS_SETTING = 'deploymentGlobalServers';
export const DEPLOYMENT_WORKSPACE_SERVERS_SETTING = 'deploymentWorkspaceServers';
export const DEPLOYMENT_WORKSPACE_TARGETS_SETTING = 'deploymentWorkspaceTargets';
export const DEPLOYMENT_PANEL_TITLE = '部署管理';
export const DEPLOYMENT_VIEW_CONTAINER_ID = PROVIDER_MANAGEMENT_VIEW_CONTAINER_ID;
export const DEPLOYMENT_VIEW_ID = 'hebai-ai-git-commit-deployment-management-view';

export const OPEN_DEPLOYMENT_MANAGEMENT_COMMAND = `${CONFIG_NAMESPACE}.openDeploymentManagement`;
export const ADD_DEPLOYMENT_SERVER_COMMAND = `${CONFIG_NAMESPACE}.addDeploymentServer`;
export const ADD_WORKSPACE_DEPLOYMENT_TARGET_COMMAND = `${CONFIG_NAMESPACE}.addWorkspaceDeploymentTarget`;
export const EDIT_WORKSPACE_DEPLOYMENT_TARGET_COMMAND = `${CONFIG_NAMESPACE}.editWorkspaceDeploymentTarget`;
export const DELETE_WORKSPACE_DEPLOYMENT_TARGET_COMMAND = `${CONFIG_NAMESPACE}.deleteWorkspaceDeploymentTarget`;
export const EDIT_DEPLOYMENT_SERVER_COMMAND = `${CONFIG_NAMESPACE}.editDeploymentServer`;
export const DELETE_DEPLOYMENT_SERVER_COMMAND = `${CONFIG_NAMESPACE}.deleteDeploymentServer`;
export const TEST_DEPLOYMENT_SERVER_COMMAND = `${CONFIG_NAMESPACE}.testDeploymentServer`;
export const OPEN_DEPLOYMENT_SERVER_TERMINAL_COMMAND = `${CONFIG_NAMESPACE}.openDeploymentServerTerminal`;
export const UPLOAD_DEPLOYMENT_FILES_COMMAND = `${CONFIG_NAMESPACE}.uploadDeploymentFiles`;
export const UPLOAD_EXPLORER_RESOURCES_COMMAND = `${CONFIG_NAMESPACE}.uploadExplorerResourcesToDeploymentTarget`;
export const RUN_DEPLOYMENT_ACTION_COMMAND = `${CONFIG_NAMESPACE}.runDeploymentAction`;
export const RUN_DEFAULT_DEPLOYMENT_ACTION_COMMAND = `${CONFIG_NAMESPACE}.runDefaultDeploymentAction`;
export const REFRESH_DEPLOYMENT_SERVERS_COMMAND = `${CONFIG_NAMESPACE}.refreshDeploymentServers`;
export const EXPORT_DEPLOYMENT_SERVERS_COMMAND = `${CONFIG_NAMESPACE}.exportDeploymentServers`;
export const IMPORT_DEPLOYMENT_SERVERS_COMMAND = `${CONFIG_NAMESPACE}.importDeploymentServers`;

export const DEPLOYMENT_SERVER_ITEM_CONTEXT = 'deploymentServer';
export const DEPLOYMENT_GLOBAL_SERVER_ITEM_CONTEXT = 'deploymentGlobalServer';
export const DEPLOYMENT_WORKSPACE_SERVER_ITEM_CONTEXT = 'deploymentWorkspaceServer';
export const DEPLOYMENT_SERVER_GROUP_CONTEXT = 'deploymentServerGroup';
export const DEPLOYMENT_GLOBAL_ROOT_CONTEXT = 'deploymentGlobalRoot';
export const DEPLOYMENT_WORKSPACE_ROOT_CONTEXT = 'deploymentWorkspaceRoot';
export const DEPLOYMENT_WORKSPACE_TARGET_ITEM_CONTEXT = 'deploymentWorkspaceTarget';
export const DEPLOYMENT_WORKSPACE_TARGET_EMPTY_ITEM_CONTEXT = 'deploymentWorkspaceTargetEmpty';

export const DEPLOYMENT_DEFAULT_TIMEOUT_SECONDS = 300;
export const DEPLOYMENT_EXPORT_FILE_EXTENSION = 'hebai-deploy.json';