export async function setupPlugin({ config, global, cache }) {
  console.info(`Setting up the plugin`);
  let baseUrl = `https://${config.hostName}.zendesk.com/`;

  global.token = Buffer.from(
    `${config.userEmail}/token:${config.zendeskApiKey}`
  ).toString("base64");

  global.baseTicketUrl =
    baseUrl + "api/v2/tickets.json?sort_order=desc&sort_by=id";

  global.fetchUserUrl = baseUrl + "api/v2/users";

  global.defaultHeaders = {
    headers: {
      Authorization: `Basic ${global.token}`,
      "Content-Type": "application/json",
    },
  };

  const authenticationResponse = await fetchWithRetry(
    global.baseTicketUrl,
    global.defaultHeaders
  );

  if (!statusOk(authenticationResponse)) {
    throw new Error(`Unable to access Zendesk API's for ${config.hostName}`);
  } else {
    console.info(
      `Initial setup with zendesk for ${config.hostName} successful`
    );
  }
}

async function pushUserDataToZendesk(
  email,
  eventName,
  sent_at,
  global,
  storage
) {
  const userId = await storage.get(email);

  if (userId) {
    const updatedHeaders = global.defaultHeaders;
    updatedHeaders.body = JSON.stringify({
      user: {
        user_fields: { [eventName]: `${sent_at}` },
      },
    });

    const retryResponse = await fetchWithRetry(
      `${global.fetchUserUrl}/${userId}`,
      updatedHeaders,
      "PUT"
    );
    await retryResponse.json();
  }
}

async function fetchUserIdentity(requesterId, global, storage) {
  const userResult = await fetchWithRetry(
    `${global.fetchUserUrl}/${requesterId}`,
    global.defaultHeaders
  );

  const user = await userResult.json();

  //   posthog.capture(user.user.email, { $set_once: { zendeskId: user.user.id } });
  await storage.set(user.user.email, user.user.id);
  return user.user.email;
}

async function fetchAllTickets(global, storage, cache) {
  let allTickets = [null];
  index = 1; // let index
  while (allTickets.length > 0) {
    const finalUrl = `${global.baseTicketUrl}&page=${index}`;

    const allTicketData = await fetchWithRetry(finalUrl, global.defaultHeaders);
    index += 1;

    allTickets = await allTicketData.json();
    allTickets = await allTickets.tickets; // no await needed here

    // nit: this isn't necessary. the loop will not do anything if allTickets.length === 0
    if (allTickets.length === 0) {
      break;
    }

    ///saves storage space

    for (let ticket of allTickets) {
      const customerRecordExists = await storage.get(ticket.id);

      // why break and not continue?
      if (!customerRecordExists) {
        await storage.set(ticket.id, true);
      } else {
        break;
      }

      const emailId = await fetchUserIdentity(
        ticket.requester_id,
        global,
        storage
      );

      // nit: let's use camelCase
      const ticket_object_to_capture = {
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
      };

      posthog.capture("zendesk_ticket", {
        distinct_id: emailId,
        $set: { zendeskId: ticket_object_to_capture.requester_id },
        ...ticket_object_to_capture,
      });
    }
  }
}

export async function onEvent(event, { config, global, storage }) {

  // let's not do this on every onEvent - better to do this validation in setupPlugin 
  // and set triggeringEvents on global.
  let triggeringEvents = (config.triggeringEvents || "")
    .split(",")
    .map(function (value) {
      return value.trim();
    });


  // nit: .includes is cleaner and is supported in plugin VMs
  if (triggeringEvents.indexOf(event.event) >= 0) {
    const email = getEmailFromEvent(event);
    if (email) {
      let emailDomainsToIgnore = (config.ignoredEmails || "")
        .split(",")
        .map(function (value) { // nit: here and above you can just do .map(v => v.trim())
          return value.trim();
        });
      if (emailDomainsToIgnore.indexOf(email.split("@")[1]) >= 0) {
        return;
      }

      // let's do this in a job rather than call it directly from onEvent
      // https://posthog.com/docs/plugins/build/reference#specifying-metrics#jobs-1
      await pushUserDataToZendesk(
        email,
        event.event,
        event["sent_at"],
        global,
        storage
      );
    }
  }
}

function getEmailFromEvent(event) {
  if (isEmail(event.distinct_id)) {
    return event.distinct_id;
  } else if (event["$set"] && Object.keys(event["$set"]).includes("email")) {
    if (isEmail(event["$set"]["email"])) {
      return event["$set"]["email"];
    }
  } else if (
    event["properties"] &&
    Object.keys(event["properties"]).includes("email")
  ) {
    if (isEmail(event["properties"]["email"])) {
      return event["properties"]["email"];
    }
  }

  return null;
}

export async function runEveryMinute({ global, storage, cache }) {
  // is latest_element_so_far ever used?
  // nit: let's use camelCase instead of snake_case
  const latest_element_so_far = await cache.get("_latest_element_so_far");
  const allTickets = await fetchAllTickets(global, storage, cache);
}

function isEmail(email) {
  const re =
    /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
  return re.test(String(email).toLowerCase());
}

function statusOk(res) {
  return String(res.status)[0] === "2";
}

async function fetchWithRetry(
  url,
  options = {},
  method = "GET",
  isRetry = false
) {
  try {
    const res = await fetch(url, { method: method, ...options });
    return res;
  } catch {
    if (isRetry) {
      throw new Error(`${method} request to ${url} failed.`);
    }
    const res = await fetchWithRetry(
      url,
      options,
      (method = method),
      (isRetry = true)
    );
    return res;
  }
}