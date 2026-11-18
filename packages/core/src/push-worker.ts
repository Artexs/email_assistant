// What the service worker of the panel imports (`@ea/core/push`): the push payload, the path of a tap and the push texts. A smaller
// entry than `@ea/core/web`, so the worker bundle holds no schema of a panel page. No module here may pull a Node module.
export * from "./notices/push";
export * from "./texts/push";
