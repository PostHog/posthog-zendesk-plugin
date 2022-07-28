export async function setupPlugin({ config, global, cache }) {
    console.info(`Setting up the plugin`)
    let baseUrl = `https://${config.hostName}.zendesk.com/`

    global.token = Buffer.from(`${config.userEmail}/token:${config.zendeskApiKey}`).toString('base64')

    global.baseTicketUrl = baseUrl + 'api/v2/tickets.json?sort_order=desc&sort_by=id'

    global.fetchUserUrl = baseUrl + 'api/v2/users'

    global.options = {
        headers: {
            Authorization: `Basic ${global.token}`,
            'Content-Type': 'application/json',
        },
    }

    const authenticationResponse = await fetchWithRetry(global.baseTicketUrl, global.options)

    if (!statusOk(authenticationResponse)) {
        throw new Error(`Unable to access ZenDesk API's for ${config.hostName}`)
    } else {
        console.info(`Initial setup with ZenDesk for ${config.hostName} successful`)
    }

    global.triggeringEvents = (config.triggeringEvents || '').split(',').map((v) => v.trim())

    global.emailDomainsToIgnore = (config.ignoredEmails || '').split(',').map((v) => v.trim())
}

export const jobs = {
    pushUserDataToZendesk: async (request, { storage, global, cache }) => {
        const userId = await storage.get(request.email, null)

        if (userId) {
            const url = global.fetchUserUrl

            global.options.body = JSON.stringify({
                user: {
                    user_fields: { [request.event.event]: `${request.event.sent_at}` },
                },
            })

            const result = await fetchWithRetry(`${url}/${userId}`, global.options, 'PUT')
        }
    },
}
async function fetchUserIdentity(requesterId, global, storage) {
    const userResult = await fetchWithRetry(`${global.fetchUserUrl}/${requesterId}`, global.options)

    const user = await userResult.json()

    //   posthog.capture(user.user.email, { $set_once: { zendeskId: user.user.id } });
    await storage.set(user.user.email, user.user.id)
    return user.user.email
}

async function fetchAllTickets(global, storage, cache) {
    let allTickets = [null]
    let index = 1
    while (allTickets.length > 0) {
        const finalUrl = `${global.baseTicketUrl}&page=${index}`

        const allTicketData = await fetchWithRetry(finalUrl, global.options)
        index += 1

        allTickets = await allTicketData.json()
        allTickets = allTickets.tickets

        if (allTickets.length === 0) {
            break
        }

        ///saves storage space

        for (let ticket of allTickets) {
            const customerRecordExists = await storage.get(ticket.id, null)

            if (!customerRecordExists) {
                await storage.set(ticket.id, true)
            } else {
                break
            }

            const emailId = await fetchUserIdentity(ticket.requester_id, global, storage)

            const ticketObjectToSave = {
                ticketId: ticket.id,
                created_at: ticket.created_at,
                updated_at: ticket.updated_at,
                type: ticket.type,
                subject: ticket.raw_subject,
                description: ticket.description,
                priority: ticket.priority,
                status: ticket.status,
                recipient: ticket.recipient,
                requester_id: ticket.requester_id,
                submitter_id: ticket.submitter_id,
                assignee_id: ticket.assignee_id,
                organization_id: ticket.organization_id,
                group_id: ticket.group_id,
                is_public: ticket.is_public,
                due_at: ticket.due_at,
                ticket_form_id: ticket.ticket_form_id,
                brand_id: ticket.brand_id,
            }

            posthog.capture('zendesk_ticket', {
                distinct_id: emailId,
                $set: { zendeskId: ticketObjectToSave.requester_id },
                ...ticketObjectToSave,
            })
        }
    }
}

export async function onEvent(event, { jobs, config, global, storage }) {
    if (global.triggeringEvents.includes(event.event)) {
        const email = getEmailFromEvent(event)
        if (email) {
            if (global.emailDomainsToIgnore.includes(email.split('@')[1])) {
                return
            }

            const request = {
                email: email,
                event: event,
            }
            await jobs.pushUserDataToZendesk(request).runNow()
        }
    }
}

function getEmailFromEvent(event) {
    if (isEmail(event.distinct_id)) {
        return event.distinct_id
    } else if (event['$set'] && Object.keys(event['$set']).includes('email')) {
        if (isEmail(event['$set']['email'])) {
            return event['$set']['email']
        }
    } else if (event['properties'] && Object.keys(event['properties']).includes('email')) {
        if (isEmail(event['properties']['email'])) {
            return event['properties']['email']
        }
    }

    return null
}

export async function runEveryMinute({ global, storage, cache }) {
    const allTickets = await fetchAllTickets(global, storage, cache)
}

function isEmail(email) {
    const re =
        /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/
    return re.test(String(email).toLowerCase())
}

function statusOk(res) {
    return String(res.status)[0] === '2'
}

async function fetchWithRetry(url, options = {}, method = 'GET') {
    try {
        const res = await fetch(url, { method: method, ...options })
        return res
    } catch (e) {
        throw new RetryError(e.toString())
    }
}
