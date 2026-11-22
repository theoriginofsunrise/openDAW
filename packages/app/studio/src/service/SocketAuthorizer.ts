// Adds the login to the address of a connection to our own server. Set once at the start of the app (boot.ts), and
// kept apart from the rest so that the code that opens sockets stays light.
export namespace SocketAuthorizer {
    let authorizer: (address: string) => string = address => address

    export const set = (value: (address: string) => string): void => {authorizer = value}

    export const authorize = (address: string): string => authorizer(address)
}
