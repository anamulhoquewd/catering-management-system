import { z } from "zod";
import { defaults } from "../config/defaults";
import { Customer, Order, Payment } from "../models";
import { pagination } from "../lib";
import idSchema from "../controllers/utils";
import { schemaValidationError } from "./utile";

// Customer interface
interface ICustomer {
  name: string;
  phone: string;
  address: string;
  defaultItem: "lunch" | "dinner" | "lunch&dinner";
  defaultPrice: number;
  defaultQuantity: number;
  paymentSystem: "weekly" | "monthly";
  defaultOffDays: [string];
  active: boolean;
}

export const getCustomersService = async (queryParams: {
  page: number;
  limit: number;
  search: string;
  sortType: string;
  sortBy: string;
  active: boolean;
}) => {
  const { sortBy, sortType, page, limit, search, active } = queryParams;
  const querySchema = z.object({
    sortBy: z
      .enum(["createdAt", "updatedAt", "name"])
      .optional()
      .default(defaults.sortBy as "createdAt" | "updatedAt" | "name"),
    sortType: z
      .enum(["asc", "desc"])
      .optional()
      .default(defaults.sortType as "asc" | "desc"),
    active: z.boolean().optional(),
  });

  const queryValidation = querySchema.safeParse({
    sortBy,
    sortType,
    active,
  });

  if (!queryValidation.success) {
    return {
      error: schemaValidationError(
        queryValidation.error,
        "Invalid query params"
      ),
    };
  }

  const query: any = {
    active,
  };
  if (search) {
    query.$or = [
      { name: { $regex: search, $options: "i" } },
      { phone: { $regex: search, $options: "i" } },
    ];
  }

  const validSortFields = ["createdAt", "updatedAt", "name"];
  const sortField = validSortFields.includes(queryValidation.data.sortBy)
    ? queryValidation.data.sortBy
    : "updatedAt";
  const sortDirection =
    queryValidation.data.sortType.toLocaleLowerCase() === "asc" ? 1 : -1;

  try {
    const users = await Customer.find(query)
      .sort({ [sortField]: sortDirection })
      .skip((page - 1) * limit)
      .limit(limit)
      .select("-accessKey -accessKeyExpiredAt");

    const totalCustomers = await Customer.countDocuments(query);

    const getPagination = pagination({
      page,
      limit,
      total: totalCustomers,
    });

    return {
      success: {
        success: true,
        message: "Users fetched successfully",
        data: users,
        pagination: getPagination,
      },
    };
  } catch (error: any) {
    return {
      serverError: {
        success: false,
        message: error.message,
        stack: process.env.NODE_ENV === "production" ? null : error.stack,
      },
    };
  }
};

export const registerCustomerService = async (body: ICustomer) => {
  //  Validate the data
  const customerSchemaZod = z
    .object({
      name: z.string().min(3).max(50),
      phone: z
        .string()
        .regex(
          /^01\d{9}$/,
          "Phone number must start with 01 and be exactly 11 digits"
        ),
      address: z.string().max(100),
      defaultItem: z.enum(["lunch", "dinner", "lunch&dinner"]),
      defaultPrice: z.number(),
      defaultQuantity: z.number(),
      paymentSystem: z.enum(["weekly", "monthly"]),
      active: z.boolean().default(true),
      defaultOffDays: z
        .array(z.enum(["sa", "su", "mo", "tu", "we", "th", "fr"]))
        .nonempty(),
    })
    .refine(
      (data) =>
        data.defaultOffDays?.every((day: string) =>
          ["sa", "su", "mo", "tu", "we", "th", "fr"].includes(day)
        ) ?? true,
      {
        message:
          "Default off days must be in the following order: sa, su, mo, tu, we, th, fr",
        path: ["defaultOffDays"],
      }
    );

  // Validate the data
  const bodyValidation = customerSchemaZod.safeParse(body);
  if (!bodyValidation.success) {
    return {
      error: schemaValidationError(
        bodyValidation.error,
        "Invalid request body"
      ),
    };
  }

  const {
    name,
    phone,
    address,
    defaultItem,
    defaultPrice,
    defaultQuantity,
    paymentSystem,
    defaultOffDays,
    active,
  } = bodyValidation.data;

  try {
    // Check if customer already exists
    const existingCustomer = await Customer.findOne({ phone }).select("phone");

    if (existingCustomer) {
      return {
        error: {
          msg: "Customer already exists",
          fields: [
            {
              name: "phone",
              message: "Phone number must be unique",
            },
          ],
        },
      };
    }

    // Create new customer
    const customer = new Customer({
      name,
      phone,
      address,
      defaultItem,
      defaultPrice,
      defaultQuantity,
      paymentSystem,
      defaultOffDays,
      active,
    });

    // Generate and hash access key
    const accessKey = customer.generateAccessKey(60);

    // Save customer
    const docs = await customer.save();

    // Response
    return {
      success: {
        success: true,
        message: "Customer created successfully",
        data: docs,
        accessKey,
      },
    };
  } catch (error: any) {
    return {
      serverError: {
        success: false,
        message: error.message,
        stack: process.env.NODE_ENV === "production" ? null : error.stack,
      },
    };
  }
};

export const getSingleCustomerService = async (id: string) => {
  // Validate ID
  const idValidation = idSchema.safeParse({ id });
  if (!idValidation.success) {
    return {
      error: schemaValidationError(idValidation.error, "Invalid ID"),
    };
  }

  try {
    // Check if customer exists
    const customer = await Customer.findById(idValidation.data.id);

    if (!customer) {
      return {
        error: {
          msg: "Customer not found with the provided ID",
        },
      };
    }

    // Response
    return {
      success: {
        success: true,
        message: "Customer fetched successfully",
        data: customer,
      },
    };
  } catch (error: any) {
    return {
      serverError: {
        success: false,
        message: error.message,
        stack: process.env.NODE_ENV === "production" ? null : error.stack,
      },
    };
  }
};

export const updateCustomerService = async ({
  body,
  id,
}: {
  id: string;
  body: ICustomer;
}) => {
  //  Validate the data
  const customerSchemaZod = z
    .object({
      name: z.string().min(3).max(50).optional(),
      phone: z
        .string()
        .regex(
          /^01\d{9}$/,
          "Phone number must start with 01 and be exactly 11 digits"
        )
        .optional(),
      address: z.string().max(100).optional(),
      defaultItem: z.enum(["lunch", "dinner", "lunch&dinner"]).optional(),
      defaultPrice: z.number().optional(),
      defaultQuantity: z.number().optional(),
      paymentSystem: z.enum(["weekly", "monthly"]).optional(),
      active: z.boolean().optional(),
      defaultOffDays: z
        .array(z.enum(["sa", "su", "mo", "tu", "we", "th", "fr"]))
        .nonempty()
        .optional(),
    })
    .refine(
      (data) =>
        data.defaultOffDays?.every((day: string) =>
          ["sa", "su", "mo", "tu", "we", "th", "fr"].includes(day)
        ) ?? true,
      {
        message:
          "Default off days must be in the following order: sa, su, mo, tu, we, th, fr",
        path: ["defaultOffDays"],
      }
    );

  // Validate ID
  const idValidation = idSchema.safeParse({ id });
  if (!idValidation.success) {
    return {
      error: schemaValidationError(idValidation.error, "Invalid ID"),
    };
  }

  // Validate the data
  const bodyValidation = customerSchemaZod.safeParse(body);
  if (!bodyValidation.success) {
    return {
      error: schemaValidationError(
        bodyValidation.error,
        "Invalid request body"
      ),
    };
  }

  try {
    // Check if customer exists
    const customer = await Customer.findById(idValidation.data.id);

    if (!customer) {
      return {
        error: {
          msg: "Customer not found with the provided ID",
        },
      };
    }

    // Check if any field is provided
    if (Object.keys(bodyValidation.data).length === 0) {
      return {
        success: {
          success: true,
          msg: "Customer not found with the provided ID",
          data: customer,
        },
      };
    }

    // Update only provided fields
    Object.assign(customer, bodyValidation.data);
    const docs = await customer.save();

    // Response
    return {
      success: {
        success: true,
        message: "Customer updated successfully",
        data: docs,
      },
    };
  } catch (error: any) {
    return {
      serverError: {
        success: false,
        message: error.message,
        stack: process.env.NODE_ENV === "production" ? null : error.stack,
      },
    };
  }
};

export const deleteCustomerService = async (id: string) => {
  // Validate ID
  const idValidation = idSchema.safeParse({ id });
  if (!idValidation.success) {
    return {
      error: schemaValidationError(idValidation.error, "Invalid ID"),
    };
  }

  try {
    // Check if customer exists
    const customer = await Customer.findById(idValidation.data.id);
    if (!customer) {
      return {
        error: {
          msg: "Customer not found with the provided ID",
        },
      };
    }

    // Delete customer
    await customer.deleteOne();

    // Response
    return {
      success: {
        success: true,
        message: "Customer deleted successfully",
      },
    };
  } catch (error: any) {
    return {
      serverError: {
        success: false,
        message: error.message,
        stack: process.env.NODE_ENV === "production" ? null : error.stack,
      },
    };
  }
};

export const regenerateAccessKeyService = async (id: string) => {
  // Validate ID
  const idValidation = idSchema.safeParse({ id });
  if (!idValidation.success) {
    return {
      error: schemaValidationError(idValidation.error, "Invalid ID"),
    };
  }

  try {
    // Check if customer exists
    const customer = await Customer.findById(idValidation.data.id);

    if (!customer) {
      return {
        error: {
          msg: "Customer not found with the provided ID/Key",
        },
      };
    }

    // Generate and hash access key. and save finally
    const reGenerateAccessKey = customer.generateAccessKey();

    // Update customer
    await customer.save();

    // Response
    return {
      success: {
        success: true,
        message: "Access key regenerated successfully",
        accessKey: reGenerateAccessKey,
      },
    };
  } catch (error: any) {
    return {
      serverError: {
        success: false,
        message: error.message,
        stack: process.env.NODE_ENV === "production" ? null : error.stack,
      },
    };
  }
};

export const customerAccessService = async ({
  key,
  queryParams,
}: {
  key: string | undefined;
  queryParams: {
    oPage: number;
    pPage: number;
    limit: number;
    sortBy: string;
    sortType: string;
    fromDate: string | null;
    toDate: string | null;
  };
}) => {
  const { oPage, pPage, limit, sortBy, sortType, fromDate, toDate } =
    queryParams;

  // Validate key
  const keySchema = z.object({
    key: z.string().refine((val) => val.length === 64, {
      message: "Invalid access key format",
    }),
  });

  // Validate access key
  const keyValidation = keySchema.safeParse({ key });
  if (!keyValidation.success) {
    console.log(keyValidation.error);
    return {
      error: schemaValidationError(
        keyValidation.error,
        "Invalid access key format"
      ),
    };
  }

  // Validate query
  const querySchema = z.object({
    sortBy: z
      .enum(["createdAt", "updatedAt"])
      .optional()
      .default(defaults.sortBy as "createdAt" | "updatedAt"),
    sortType: z
      .enum(["asc", "desc"])
      .optional()
      .default(defaults.sortType as "asc" | "desc"),
  });

  // Validate query
  const queryValidation = querySchema.safeParse({
    sortBy,
    sortType,
  });
  if (!queryValidation.success) {
    return {
      error: {
        msg: "Invalid query parameters",
        fields: queryValidation.error.issues.map((issue) => ({
          name: String(issue.path[0]),
          message: issue.message,
        })),
      },
    };
  }

  try {
    // Check if access key is valid
    const customer = await Customer.findOne({
      accessKey: keyValidation.data.key,
      accessKeyExpiredAt: { $gt: Date.now() }, // 🔹 Must be greater than the current time
    });

    // Check if customer exists
    if (!customer) {
      return {
        error: {
          msg: "Access key is not valid. Please request for a new key.",
        },
      };
    }

    // Validate sort field
    const validSortFields = ["createdAt", "updatedAt"];
    const sortField = validSortFields.includes(queryValidation.data.sortBy)
      ? queryValidation.data.sortBy
      : "updatedAt";
    const sortDirection =
      queryValidation.data.sortType.toLocaleLowerCase() === "asc" ? 1 : -1;

    // Validate date range
    const dateFilter: any = {};
    if (fromDate && toDate) {
      dateFilter.$gte = new Date(fromDate);
      dateFilter.$lte = new Date(toDate);
    }

    // Query for orders
    const orderQuery = {
      customerId: customer._id,
      ...(fromDate && toDate ? { date: dateFilter } : {}), // 🔹 sort by date range
    };

    // Query for payments
    const paymentQuery = {
      customerId: customer._id,
      ...(fromDate && toDate ? { updatedAt: dateFilter } : {}), // 🔹 sort by date range
    };

    // Get orders
    const orders = await Order.find(orderQuery)
      .sort({ [sortField]: sortDirection })
      .skip((oPage - 1) * limit)
      .limit(limit);

    // Get total orders count
    const totalOrders = await Order.countDocuments(orderQuery);

    // Get payments
    const payments = await Payment.find(paymentQuery)
      .sort({ [sortField]: sortDirection })
      .skip((pPage - 1) * limit)
      .limit(limit);

    // Get total payments count
    const totalPayments = await Payment.countDocuments(paymentQuery);

    // Calculate total payment pages
    const totalPaymentPages = Math.ceil(totalPayments / limit);

    // Response
    return {
      success: {
        success: true,
        message: "Customer fetched successfully",
        data: {
          self: customer,
          orders: {
            data: orders,
            pagination: pagination({ page: oPage, limit, total: totalOrders }),
          },
          payments: {
            data: payments,
            pagination: pagination({
              page: pPage,
              limit,
              total: totalPaymentPages,
            }),
          },
        },
      },
    };
  } catch (error: any) {
    return {
      serverError: {
        success: false,
        message: error.message,
        stack: process.env.NODE_ENV === "production" ? null : error.stack,
      },
    };
  }
};
