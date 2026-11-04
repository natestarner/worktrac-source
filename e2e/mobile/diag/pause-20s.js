// DIAGNOSTIC (#434): 20 seconds with no screen queries. Maestro runs this on the host, so the
// device sees nothing from Maestro while it loops.
const until = Date.now() + 20000;
while (Date.now() < until) {}
